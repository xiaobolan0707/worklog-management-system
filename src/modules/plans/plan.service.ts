import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { lockPersonnelActivity } from "../../shared/personnel-lock.js";
import { availableArchive } from "../archives/archive.service.js";
import type { ApproverService } from "../users/approver.service.js";
import { periodRange, type PeriodType } from "../reports/report.service.js";

export type PlanRatingValue = "MET" | "DELAYED" | "UNMET";

export class PlanError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
  }
}

export interface PlanInput {
  target: string;
  dueAt?: string | null | undefined;
}

function dayStart(date: string) {
  return new Date(`${date}T00:00:00.000Z`);
}

async function requireActiveAccount(tx: Prisma.TransactionClient, id: string) {
  const user = await tx.user.findFirst({ where: { id, ...availableArchive, employmentStatus: "ACTIVE", accountStatus: "ACTIVE" }, select: { id: true } });
  if (!user) throw new PlanError(403, "PLAN_READ_ONLY", "当前账号无法修改工作计划");
}

async function lockWritablePlanOwner(tx: Prisma.TransactionClient, id: string) {
  await lockPersonnelActivity(tx);
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${id} FOR UPDATE`;
  await requireActiveAccount(tx, id);
}

/** 工作计划：员工按天填目标，审批人评 MET / DELAYED / UNMET；与日志红灰定色互不影响。 */
export class PlanService {
  constructor(
    private readonly database: PrismaClient,
    private readonly approvers: ApproverService,
    private readonly now: () => Date = () => new Date()
  ) {}

  listMine(employeeId: string, from: string, to: string) {
    return this.database.workPlan.findMany({
      where: {
        employeeId,
        employee: availableArchive,
        workDate: { gte: dayStart(from), lte: dayStart(to) }
      },
      include: { ratedBy: { select: { displayName: true, username: true } } },
      orderBy: { workDate: "desc" }
    });
  }

  async saveMine(employeeId: string, date: string, input: PlanInput) {
    const workDate = dayStart(date);
    return this.database.$transaction(async (tx) => {
      await lockWritablePlanOwner(tx, employeeId);
      const existing = await tx.workPlan.findUnique({ where: { employeeId_workDate: { employeeId, workDate } } });
      if (existing && existing.status !== "DRAFT") {
        throw new PlanError(409, "PLAN_LOCKED", "计划已提交或已评星，不能再修改");
      }
      const data = { target: input.target, dueAt: input.dueAt ? new Date(input.dueAt) : null };
      return existing
        ? tx.workPlan.update({ where: { id: existing.id }, data })
        : tx.workPlan.create({ data: { employeeId, workDate, ...data } });
    });
  }

  async submit(employeeId: string, date: string) {
    const workDate = dayStart(date);
    return this.database.$transaction(async (tx) => {
      await lockWritablePlanOwner(tx, employeeId);
      const existing = await tx.workPlan.findUnique({ where: { employeeId_workDate: { employeeId, workDate } } });
      if (!existing) throw new PlanError(404, "PLAN_NOT_FOUND", "请先填写当日计划");
      if (existing.status !== "DRAFT") throw new PlanError(409, "PLAN_LOCKED", "计划已提交，等待评星");
      return tx.workPlan.update({ where: { id: existing.id }, data: { status: "SUBMITTED", submittedAt: this.now() } });
    });
  }

  async listPending(actorId: string, role: string) {
    // 产品口径：LEADER 只看审批授权员工；MANAGEMENT/ADMIN 作为兜底评星人覆盖全公司
    // （直属领导离职或未配置审批链时仍能完成评星）。
    const employeeIds = role === "LEADER" ? await this.approvers.listAuthorizedEmployeeIds(actorId) : null;
    return this.database.workPlan.findMany({
      where: {
        status: "SUBMITTED",
        employee: availableArchive,
        ...(employeeIds === null ? {} : { employeeId: { in: employeeIds } })
      },
      include: {
        employee: {
          select: { displayName: true, username: true, department: { select: { name: true } } }
        }
      },
      orderBy: [{ workDate: "asc" }, { submittedAt: "asc" }]
    });
  }

  async rate(planId: string, actorId: string, role: string, rating: PlanRatingValue, note?: string) {
    return this.database.$transaction(async (tx) => {
      await lockPersonnelActivity(tx);
      await requireActiveAccount(tx, actorId);
      await tx.$queryRaw`SELECT id FROM work_plans WHERE id = ${planId} FOR UPDATE`;
      const plan = await tx.workPlan.findUnique({ where: { id: planId, employee: availableArchive } });
      if (!plan) throw new PlanError(404, "PLAN_NOT_FOUND", "计划不存在");
      if (plan.status === "DRAFT") throw new PlanError(409, "PLAN_NOT_SUBMITTED", "计划尚未提交");
      if (plan.status === "RATED") throw new PlanError(409, "PLAN_ALREADY_RATED", "该计划已评星，不能重复评价");
      if (plan.employeeId === actorId) throw new PlanError(403, "SELF_RATING", "不能评价自己的计划");
      if (role === "LEADER" && !await tx.employeeApprover.findFirst({ where: { approverId: actorId, employeeId: plan.employeeId, active: true }, select: { id: true } })) {
        throw new PlanError(403, "FORBIDDEN", "只能评价自己负责的员工");
      }
      return tx.workPlan.update({ where: { id: planId }, data: { rating, note: note ?? null, ratedById: actorId, ratedAt: this.now(), status: "RATED" } });
    });
  }

  /**
   * 评星榜：红色榜 = MET 次数前五，灰色榜 = UNMET 次数前三。
   * DELAYED 延期完成不参与排行（与线上口径一致）；同次数按姓名、再按 ID 稳定排序。
   */
  async leaderboard(type: PeriodType, referenceDate: string) {
    const range = periodRange(type, referenceDate);
    const plans = await this.database.workPlan.findMany({
      where: {
        status: "RATED",
        rating: { in: ["MET", "UNMET"] },
        employee: { recycledAt: null, archivePurgingAt: null, archivePurgedAt: null },
        workDate: { gte: dayStart(range.start), lte: dayStart(range.end) }
      },
      select: {
        employeeId: true,
        rating: true,
        employee: { select: { displayName: true, username: true } }
      }
    });

    const counts = new Map<string, { employeeId: string; employeeName: string; met: number; unmet: number }>();
    for (const plan of plans) {
      // 延期完成不参与排行：不仅在查询条件里排除，聚合时再兜一层，避免上游改查询后口径漂移。
      if (plan.rating !== "MET" && plan.rating !== "UNMET") continue;
      const entry = counts.get(plan.employeeId) ?? {
        employeeId: plan.employeeId,
        employeeName: plan.employee.displayName ?? plan.employee.username,
        met: 0,
        unmet: 0
      };
      if (plan.rating === "MET") entry.met += 1;
      else entry.unmet += 1;
      counts.set(plan.employeeId, entry);
    }
    const top = (key: "met" | "unmet", limit: number) => [...counts.values()]
      .filter((entry) => entry[key] > 0)
      .sort((a, b) => b[key] - a[key]
        || a.employeeName.localeCompare(b.employeeName)
        || a.employeeId.localeCompare(b.employeeId))
      .slice(0, limit)
      .map((entry) => ({ employeeId: entry.employeeId, employeeName: entry.employeeName, count: entry[key] }));

    // 字段名明确表达「计划评星」口径，避免与日志红灰定色的排行榜混淆。
    return { ...range, metTop5: top("met", 5), unmetTop3: top("unmet", 3) };
  }
}
