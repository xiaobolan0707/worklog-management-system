import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { lockPersonnelActivity } from "../../shared/personnel-lock.js";
import { appendAudit } from "../audit/audit.repository.js";
import type { ItemCommentRecord } from "../logs/log.repository.js";
import type { LogImagePayload } from "../logs/log.schemas.js";

export interface ApprovalStepRecord {
  approverId: string;
  approverName: string;
  approverRole: string;
  position: number;
  status: string;
  color?: "RED" | "GRAY" | null;
  comment?: string | null;
  itemComments: ItemCommentRecord[];
  actedAt: string | null;
}

/**
 * PERF-03：待审列表不再内联 base64 图片。
 * 生产环境中 75 条待审日志内联图片后响应达 50MB，nginx 直接返回 502，
 * 管理层与管理员（全公司范围）的审批页面因此显示"暂无待审日志"。
 * 这里只返回图片元数据 + 按需加载地址，图片由 /api/logs/:id/images/:imageId 单独下发。
 */
export interface ApprovalLogImage {
  id: string;
  name: string;
  type: LogImagePayload["type"];
  size: number;
  url: string;
}

export interface ApprovalLogRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeDepartmentId: string | null;
  workDate: string;
  isBackfill: boolean;
  submittedAt: string | null;
  status: string;
  color: "GREEN" | "RED" | "GRAY" | null;
  version: number;
  items: {
    position: number;
    content: string;
    completed: boolean;
    unfinishedReason: string | null;
    images: ApprovalLogImage[];
  }[];
  approvalSteps: ApprovalStepRecord[];
}

export type ApprovalResult = ApprovalLogRecord | "NOT_FOUND" | "CONFLICT";

export type ApprovalRole = "LEADER" | "MANAGEMENT" | "ADMIN";

/** 审批人身份：角色 + 所属部门，决定他能看到并处理哪些日志。 */
export interface ApprovalActor {
  id: string;
  role: ApprovalRole;
  departmentId: string | null;
}

/**
 * 审批范围口径：
 * - 管理层 / 管理员：全公司所有日志；
 * - 领导：本部门员工的日志，外加被显式指派到审批链上的跨部门员工。
 */
export function canActOnStep(actor: ApprovalActor, log: ApprovalLogRecord, currentApproverId: string): boolean {
  if (actor.role === "MANAGEMENT" || actor.role === "ADMIN") return true;
  if (currentApproverId === actor.id) return true;
  return Boolean(actor.departmentId && log.employeeDepartmentId === actor.departmentId);
}

export interface ApprovalRepository {
  findApprovalLog(logId: string): Promise<ApprovalLogRecord | null>;
  approve(logId: string, actorId: string, color: "RED" | "GRAY", itemComments: ItemCommentRecord[]): Promise<ApprovalResult>;
  returnLog(logId: string, actorId: string, itemComments: ItemCommentRecord[]): Promise<ApprovalResult>;
  changeColor(
    logId: string,
    actor: ApprovalActor,
    color: "RED" | "GRAY",
    reason: string
  ): Promise<ApprovalLogRecord | "FORBIDDEN" | null>;
  listPending(actor: ApprovalActor): Promise<ApprovalLogRecord[]>;
}

export class ApprovalError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
  }
}

export class ApprovalService {
  constructor(
    private readonly repository: ApprovalRepository
  ) {}

  private async assertCurrent(logId: string, actor: ApprovalActor) {
    const log = await this.repository.findApprovalLog(logId);
    if (!log) throw new ApprovalError(403, "FORBIDDEN", "无权操作此日志");
    const current = log.approvalSteps.find((step) => step.status === "PENDING");
    if (!current || !canActOnStep(actor, log, current.approverId)) {
      throw new ApprovalError(403, "NOT_CURRENT_APPROVER", "尚未轮到您审批此日志");
    }
    return log;
  }

  private validateItemComments(log: ApprovalLogRecord, itemComments: ItemCommentRecord[]) {
    const expected = log.items.map((item) => item.position).sort((a, b) => a - b);
    const actual = itemComments.map((item) => item.itemPosition).sort((a, b) => a - b);
    if (
      expected.length !== actual.length ||
      expected.some((position, index) => position !== actual[index]) ||
      itemComments.some((item) => !item.comment.trim())
    ) {
      throw new ApprovalError(400, "ITEM_COMMENTS_INCOMPLETE", "请针对每一项工作填写批注");
    }
    return expected.map((position) => ({
      itemPosition: position,
      comment: itemComments.find((item) => item.itemPosition === position)!.comment.trim()
    }));
  }

  async approveCurrentStep(
    logId: string,
    actor: ApprovalActor,
    color: "RED" | "GRAY",
    itemComments: ItemCommentRecord[]
  ) {
    if (color !== "RED" && color !== "GRAY") {
      throw new ApprovalError(400, "INVALID_COLOR", "核查结果只能选择完成或未完成");
    }
    const log = await this.assertCurrent(logId, actor);
    const normalizedComments = this.validateItemComments(log, itemComments);
    const result = await this.repository.approve(logId, actor.id, color, normalizedComments);
    if (result === "CONFLICT") {
      throw new ApprovalError(409, "APPROVAL_CONFLICT", "日志已被处理，请刷新");
    }
    if (result === "NOT_FOUND") throw new ApprovalError(403, "FORBIDDEN", "无权操作此日志");
    return result;
  }

  async returnCurrentStep(logId: string, actor: ApprovalActor, itemComments: ItemCommentRecord[]) {
    const log = await this.assertCurrent(logId, actor);
    const normalizedComments = this.validateItemComments(log, itemComments);
    const result = await this.repository.returnLog(logId, actor.id, normalizedComments);
    if (result === "CONFLICT") throw new ApprovalError(409, "APPROVAL_CONFLICT", "日志已被处理，请刷新");
    if (result === "NOT_FOUND") throw new ApprovalError(403, "FORBIDDEN", "无权操作此日志");
    return result;
  }

  async changeReviewedColor(
    logId: string,
    actor: ApprovalActor,
    color: "RED" | "GRAY",
    reason: string
  ) {
    if (color !== "RED" && color !== "GRAY") {
      throw new ApprovalError(400, "INVALID_COLOR", "核查结果只能选择完成或未完成");
    }
    if (!reason.trim()) {
      throw new ApprovalError(400, "COLOR_CHANGE_REASON_REQUIRED", "修改颜色必须填写原因");
    }
    const result = await this.repository.changeColor(logId, actor, color, reason.trim());
    if (!result || result === "FORBIDDEN") {
      throw new ApprovalError(403, "FORBIDDEN", "无权修改此日志颜色");
    }
    return result;
  }

  listPending(actor: ApprovalActor) {
    return this.repository.listPending(actor);
  }
}

function dateText(date: Date) {
  return date.toISOString().slice(0, 10);
}

function jsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

const includeApprovalLog = {
  employee: { select: { displayName: true, username: true, departmentId: true } },
  items: { orderBy: { position: "asc" as const } },
  approvalSteps: {
    orderBy: { position: "asc" as const },
    include: { approver: { select: { displayName: true, username: true, role: true } } }
  }
} satisfies Prisma.DailyLogInclude;

type ApprovalLogWithRelations = Prisma.DailyLogGetPayload<{ include: typeof includeApprovalLog }>;

function toApprovalRecord(log: ApprovalLogWithRelations): ApprovalLogRecord {
  const steps = log.approvalSteps.filter((step) => step.submissionNumber === log.submissionCount);
  return {
    id: log.id,
    employeeId: log.employeeId,
    employeeName: log.employee.displayName ?? log.employee.username,
    employeeDepartmentId: log.employee.departmentId ?? null,
    workDate: dateText(log.workDate),
    isBackfill: log.isBackfill,
    submittedAt: log.submittedAt?.toISOString() ?? null,
    status: log.status,
    color: log.color,
    version: log.version,
    items: log.items.map((item) => ({
      position: item.position,
      content: item.content,
      completed: item.completed,
      unfinishedReason: item.unfinishedReason,
      images: jsonArray<LogImagePayload>(item.images).map((image) => ({
        id: image.id,
        name: image.name,
        type: image.type,
        size: image.size,
        url: `/api/logs/${encodeURIComponent(log.id)}/images/${encodeURIComponent(image.id)}`
      }))
    })),
    approvalSteps: steps.map((step) => ({
      approverId: step.approverId,
      approverName: step.approver.displayName ?? step.approver.username,
      approverRole: step.approver.role,
      position: step.position,
      status: step.status,
      color: step.color === "GREEN" ? null : step.color,
      comment: step.comment,
      itemComments: jsonArray<ItemCommentRecord>(step.itemComments),
      actedAt: step.actedAt?.toISOString() ?? null
    }))
  };
}

export class PrismaApprovalRepository implements ApprovalRepository {
  constructor(private readonly database: PrismaClient) {}

  private async activeApprover(transaction: Prisma.TransactionClient, id: string) {
    await lockPersonnelActivity(transaction);
    const actor = await transaction.user.findFirst({ where: { id, role: { in: ["LEADER", "MANAGEMENT", "ADMIN"] }, employmentStatus: "ACTIVE", accountStatus: "ACTIVE", recycledAt: null, archivePurgingAt: null, archivePurgedAt: null, deletedAt: null }, select: { id: true } });
    if (!actor) throw new ApprovalError(403, "APPROVER_UNAVAILABLE", "离职或停用后不能进行审批操作");
  }

  async findApprovalLog(logId: string) {
    const log = await this.database.dailyLog.findUnique({
      where: { id: logId, employee: { recycledAt: null, archivePurgingAt: null, archivePurgedAt: null } },
      include: includeApprovalLog
    });
    return log ? toApprovalRecord(log) : null;
  }

  async approve(logId: string, actorId: string, color: "RED" | "GRAY", itemComments: ItemCommentRecord[]) {
    return this.database.$transaction(async (transaction): Promise<ApprovalResult> => {
      await this.activeApprover(transaction, actorId);
      const log = await transaction.dailyLog.findUnique({
        where: { id: logId, employee: { recycledAt: null, archivePurgingAt: null, archivePurgedAt: null } },
        include: { approvalSteps: { orderBy: { position: "asc" } } }
      });
      if (!log) return "NOT_FOUND";
      const steps = log.approvalSteps.filter((step) => step.submissionNumber === log.submissionCount);
      const current = steps.find((step) => step.status === "PENDING");
      // SEC：授权已由 ApprovalService.assertCurrent 按「管理层全公司 / 领导本部门」判定，
      // 这里只做并发守卫——用步骤 ID + PENDING 状态做 CAS，防止两人同时点。
      if (!current) return "CONFLICT";
      const updated = await transaction.approvalStep.updateMany({
        where: { id: current.id, status: "PENDING" },
        data: {
          status: "APPROVED",
          color,
          comment: null,
          itemComments: itemComments as unknown as Prisma.InputJsonValue,
          actedAt: new Date()
        }
      });
      if (updated.count !== 1) return "CONFLICT";
      const final = !steps.some((step) => step.status === "PENDING" && step.id !== current.id);
      const changed = await transaction.dailyLog.updateMany({
        where: { id: logId, version: log.version },
        data: {
          status: final ? "ARCHIVED" : "IN_REVIEW",
          color,
          archivedAt: final ? new Date() : null,
          version: { increment: 1 }
        }
      });
      if (changed.count !== 1) return "CONFLICT";
      await appendAudit(transaction, {
        actorId,
        subjectUserId: log.employeeId,
        action: "LOG_APPROVED",
        entityType: "DailyLog",
        entityId: logId,
        metadata: { color, position: current.position, final, itemComments } as unknown as Prisma.InputJsonValue
      });
      return (await new PrismaApprovalRepository(transaction as unknown as PrismaClient).findApprovalLog(logId))!;
    });
  }

  async returnLog(logId: string, actorId: string, itemComments: ItemCommentRecord[]) {
    return this.database.$transaction(async (transaction): Promise<ApprovalResult> => {
      await this.activeApprover(transaction, actorId);
      const log = await transaction.dailyLog.findUnique({
        where: { id: logId, employee: { recycledAt: null, archivePurgingAt: null, archivePurgedAt: null } },
        include: { approvalSteps: { orderBy: { position: "asc" } } }
      });
      if (!log) return "NOT_FOUND";
      const current = log.approvalSteps.find(
        (step) => step.submissionNumber === log.submissionCount && step.status === "PENDING"
      );
      if (!current) return "CONFLICT";
      const changed = await transaction.approvalStep.updateMany({
        where: { id: current.id, status: "PENDING" },
        data: {
          status: "RETURNED",
          comment: null,
          itemComments: itemComments as unknown as Prisma.InputJsonValue,
          actedAt: new Date()
        }
      });
      if (changed.count !== 1) return "CONFLICT";
      await transaction.approvalStep.updateMany({
        where: {
          dailyLogId: logId,
          submissionNumber: log.submissionCount,
          status: "PENDING"
        },
        data: { status: "SUPERSEDED" }
      });
      await transaction.dailyLog.update({
        where: { id: logId, employee: { recycledAt: null, archivePurgingAt: null, archivePurgedAt: null } },
        data: { status: "RETURNED", color: "GREEN", version: { increment: 1 } }
      });
      await appendAudit(transaction, {
        actorId,
        subjectUserId: log.employeeId,
        action: "LOG_RETURNED",
        entityType: "DailyLog",
        entityId: logId,
        metadata: { itemComments } as unknown as Prisma.InputJsonValue
      });
      return (await new PrismaApprovalRepository(transaction as unknown as PrismaClient).findApprovalLog(logId))!;
    });
  }

  async changeColor(logId: string, actor: ApprovalActor, color: "RED" | "GRAY", reason: string) {
    return this.database.$transaction(async (transaction) => {
      await this.activeApprover(transaction, actor.id);
      const log = await transaction.dailyLog.findUnique({
        where: { id: logId, employee: { recycledAt: null, archivePurgingAt: null, archivePurgedAt: null } },
        include: { approvalSteps: true, employee: { select: { departmentId: true } } }
      });
      if (!log || log.status !== "ARCHIVED") return null;
      // SEC-09：只有"本轮提交中已完成审批的最终审批人"可以调整归档结论。
      // 历史轮次（SUPERSEDED）的审批人不再具备改色权限，避免"审过一次即可永久改结论"。
      // 管理层/管理员按职责可调整全公司结论；领导限本部门（或被显式指派）的日志。
      const currentRoundApproved = log.approvalSteps.filter(
        (step) => step.submissionNumber === log.submissionCount && step.status === "APPROVED"
      );
      const finalApprover = currentRoundApproved.sort((a, b) => b.position - a.position)[0];
      const isManager = actor.role === "MANAGEMENT" || actor.role === "ADMIN";
      const sameDepartment = Boolean(actor.departmentId && log.employee.departmentId === actor.departmentId);
      if (!finalApprover || !(isManager || sameDepartment || finalApprover.approverId === actor.id)) {
        return "FORBIDDEN" as const;
      }
      const fromColor = log.color;
      if (fromColor !== "RED" && fromColor !== "GRAY") return null;
      await transaction.dailyLog.update({
        where: { id: logId, employee: { recycledAt: null, archivePurgingAt: null, archivePurgedAt: null } },
        data: { color, version: { increment: 1 } }
      });
      await transaction.colorChange.create({
        data: { dailyLogId: logId, changedById: actor.id, fromColor, toColor: color, reason }
      });
      await appendAudit(transaction, {
        actorId: actor.id,
        subjectUserId: log.employeeId,
        action: "LOG_COLOR_CHANGED",
        entityType: "DailyLog",
        entityId: logId,
        metadata: { fromColor, toColor: color, reason }
      });
      return (await new PrismaApprovalRepository(transaction as unknown as PrismaClient).findApprovalLog(logId))!;
    });
  }

  async listPending(actor: ApprovalActor) {
    // PERF-02：先筛出本轮待办，再一次性批量加载，消除逐条 findApprovalLog 的 N+1。
    const employeeFilter = { recycledAt: null, archivePurgingAt: null, archivePurgedAt: null };
    // 管理层/管理员看全公司；领导看本部门 + 被显式指派的跨部门员工。
    const scope: Prisma.ApprovalStepWhereInput[] = actor.role === "LEADER"
      ? [{
        OR: [
          { approverId: actor.id },
          ...(actor.departmentId
            ? [{ dailyLog: { employee: { ...employeeFilter, departmentId: actor.departmentId } } }]
            : [])
        ]
      }]
      : [];
    const steps = await this.database.approvalStep.findMany({
      where: {
        AND: [
          { status: "PENDING", dailyLog: { employee: employeeFilter } },
          ...scope
        ]
      },
      include: { dailyLog: true },
      orderBy: [{ dailyLog: { submittedAt: { sort: "desc", nulls: "last" } } }, { position: "asc" }]
    });
    const logIds = [...new Set(
      steps.filter((step) => step.submissionNumber === step.dailyLog.submissionCount).map((step) => step.dailyLogId)
    )];
    if (logIds.length === 0) return [];
    const logs = await this.database.dailyLog.findMany({
      where: { id: { in: logIds }, employee: { recycledAt: null, archivePurgingAt: null, archivePurgedAt: null } },
      include: includeApprovalLog
    });
    const order = new Map(logIds.map((id, index) => [id, index]));
    return logs
      .map(toApprovalRecord)
      .filter((log) => {
        const pending = log.approvalSteps.find((step) => step.status === "PENDING");
        return Boolean(pending && canActOnStep(actor, log, pending.approverId));
      })
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }
}
