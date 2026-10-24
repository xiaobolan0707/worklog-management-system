import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
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

export interface ApprovalLogRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  workDate: string;
  status: string;
  color: "GREEN" | "RED" | "GRAY" | null;
  version: number;
  items: {
    position: number;
    content: string;
    completed: boolean;
    unfinishedReason: string | null;
    images: LogImagePayload[];
  }[];
  approvalSteps: ApprovalStepRecord[];
}

export type ApprovalResult = ApprovalLogRecord | "NOT_FOUND" | "CONFLICT";

export interface ApprovalRepository {
  findApprovalLog(logId: string): Promise<ApprovalLogRecord | null>;
  approve(logId: string, leaderId: string, color: "RED" | "GRAY", itemComments: ItemCommentRecord[]): Promise<ApprovalResult>;
  returnLog(logId: string, leaderId: string, itemComments: ItemCommentRecord[]): Promise<ApprovalResult>;
  changeColor(
    logId: string,
    leaderId: string,
    color: "RED" | "GRAY",
    reason: string
  ): Promise<ApprovalLogRecord | "FORBIDDEN" | null>;
  listPending(leaderId: string): Promise<ApprovalLogRecord[]>;
}

export class ApprovalError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
  }
}

function beijingDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value["year"]}-${value["month"]}-${value["day"]}`;
}

function calendarDayDifference(fromDate: string, toDate: string): number {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return (Date.parse(`${toDate}T00:00:00.000Z`) - Date.parse(`${fromDate}T00:00:00.000Z`)) /
    millisecondsPerDay;
}

export class ApprovalService {
  constructor(
    private readonly repository: ApprovalRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  private async assertCurrent(logId: string, leaderId: string) {
    const log = await this.repository.findApprovalLog(logId);
    if (!log) throw new ApprovalError(403, "FORBIDDEN", "无权操作此日志");
    const current = log.approvalSteps.find((step) => step.status === "PENDING");
    if (!current || current.approverId !== leaderId) {
      throw new ApprovalError(403, "NOT_CURRENT_APPROVER", "尚未轮到您审批此日志");
    }
    const reviewDayOffset = calendarDayDifference(log.workDate, beijingDate(this.now()));
    if (reviewDayOffset < 0 || reviewDayOffset > 2) {
      throw new ApprovalError(409, "APPROVAL_DATE_EXPIRED", "核查时间仅限日志当天起三天内");
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
    leaderId: string,
    color: "RED" | "GRAY",
    itemComments: ItemCommentRecord[]
  ) {
    if (color !== "RED" && color !== "GRAY") {
      throw new ApprovalError(400, "INVALID_COLOR", "审批只能选择红色或灰色");
    }
    const log = await this.assertCurrent(logId, leaderId);
    const normalizedComments = this.validateItemComments(log, itemComments);
    const result = await this.repository.approve(logId, leaderId, color, normalizedComments);
    if (result === "CONFLICT") {
      throw new ApprovalError(409, "APPROVAL_CONFLICT", "日志已被处理，请刷新");
    }
    if (result === "NOT_FOUND") throw new ApprovalError(403, "FORBIDDEN", "无权操作此日志");
    return result;
  }

  async returnCurrentStep(logId: string, leaderId: string, itemComments: ItemCommentRecord[]) {
    const log = await this.assertCurrent(logId, leaderId);
    const normalizedComments = this.validateItemComments(log, itemComments);
    const result = await this.repository.returnLog(logId, leaderId, normalizedComments);
    if (result === "CONFLICT") throw new ApprovalError(409, "APPROVAL_CONFLICT", "日志已被处理，请刷新");
    if (result === "NOT_FOUND") throw new ApprovalError(403, "FORBIDDEN", "无权操作此日志");
    return result;
  }

  async changeReviewedColor(
    logId: string,
    leaderId: string,
    color: "RED" | "GRAY",
    reason: string
  ) {
    if (color !== "RED" && color !== "GRAY") {
      throw new ApprovalError(400, "INVALID_COLOR", "只能选择红色或灰色");
    }
    if (!reason.trim()) {
      throw new ApprovalError(400, "COLOR_CHANGE_REASON_REQUIRED", "修改颜色必须填写原因");
    }
    const result = await this.repository.changeColor(logId, leaderId, color, reason.trim());
    if (!result || result === "FORBIDDEN") {
      throw new ApprovalError(403, "FORBIDDEN", "无权修改此日志颜色");
    }
    return result;
  }

  listPending(leaderId: string) {
    return this.repository.listPending(leaderId);
  }
}

function dateText(date: Date) {
  return date.toISOString().slice(0, 10);
}

function jsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

export class PrismaApprovalRepository implements ApprovalRepository {
  constructor(private readonly database: PrismaClient) {}

  async findApprovalLog(logId: string) {
    const log = await this.database.dailyLog.findUnique({
      where: { id: logId },
      include: {
        employee: { select: { displayName: true, username: true } },
        items: { orderBy: { position: "asc" } },
        approvalSteps: {
          orderBy: { position: "asc" },
          include: { approver: { select: { displayName: true, username: true, role: true } } }
        }
      }
    });
    if (!log) return null;
    const steps = log.approvalSteps.filter((step) => step.submissionNumber === log.submissionCount);
    return {
      id: log.id,
      employeeId: log.employeeId,
      employeeName: log.employee.displayName ?? log.employee.username,
      workDate: dateText(log.workDate),
      status: log.status,
      color: log.color,
      version: log.version,
      items: log.items.map((item) => ({
        position: item.position,
        content: item.content,
        completed: item.completed,
        unfinishedReason: item.unfinishedReason,
        images: jsonArray<LogImagePayload>(item.images)
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

  async approve(logId: string, leaderId: string, color: "RED" | "GRAY", itemComments: ItemCommentRecord[]) {
    return this.database.$transaction(async (transaction): Promise<ApprovalResult> => {
      const log = await transaction.dailyLog.findUnique({
        where: { id: logId },
        include: { approvalSteps: { orderBy: { position: "asc" } } }
      });
      if (!log) return "NOT_FOUND";
      const steps = log.approvalSteps.filter((step) => step.submissionNumber === log.submissionCount);
      const current = steps.find((step) => step.status === "PENDING");
      if (!current || current.approverId !== leaderId) return "CONFLICT";
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
        actorId: leaderId,
        subjectUserId: log.employeeId,
        action: "LOG_APPROVED",
        entityType: "DailyLog",
        entityId: logId,
        metadata: { color, position: current.position, final, itemComments } as unknown as Prisma.InputJsonValue
      });
      return (await new PrismaApprovalRepository(transaction as unknown as PrismaClient).findApprovalLog(logId))!;
    });
  }

  async returnLog(logId: string, leaderId: string, itemComments: ItemCommentRecord[]) {
    return this.database.$transaction(async (transaction): Promise<ApprovalResult> => {
      const log = await transaction.dailyLog.findUnique({
        where: { id: logId },
        include: { approvalSteps: { orderBy: { position: "asc" } } }
      });
      if (!log) return "NOT_FOUND";
      const current = log.approvalSteps.find(
        (step) => step.submissionNumber === log.submissionCount && step.status === "PENDING"
      );
      if (!current || current.approverId !== leaderId) return "CONFLICT";
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
        where: { id: logId },
        data: { status: "RETURNED", color: "GREEN", version: { increment: 1 } }
      });
      await appendAudit(transaction, {
        actorId: leaderId,
        subjectUserId: log.employeeId,
        action: "LOG_RETURNED",
        entityType: "DailyLog",
        entityId: logId,
        metadata: { itemComments } as unknown as Prisma.InputJsonValue
      });
      return (await new PrismaApprovalRepository(transaction as unknown as PrismaClient).findApprovalLog(logId))!;
    });
  }

  async changeColor(logId: string, leaderId: string, color: "RED" | "GRAY", reason: string) {
    return this.database.$transaction(async (transaction) => {
      const log = await transaction.dailyLog.findUnique({
        where: { id: logId },
        include: { approvalSteps: true }
      });
      if (!log || log.status !== "ARCHIVED") return null;
      if (!log.approvalSteps.some((step) => step.approverId === leaderId)) return "FORBIDDEN" as const;
      const fromColor = log.color;
      if (fromColor !== "RED" && fromColor !== "GRAY") return null;
      await transaction.dailyLog.update({
        where: { id: logId },
        data: { color, version: { increment: 1 } }
      });
      await transaction.colorChange.create({
        data: { dailyLogId: logId, changedById: leaderId, fromColor, toColor: color, reason }
      });
      await appendAudit(transaction, {
        actorId: leaderId,
        subjectUserId: log.employeeId,
        action: "LOG_COLOR_CHANGED",
        entityType: "DailyLog",
        entityId: logId,
        metadata: { fromColor, toColor: color, reason }
      });
      return (await new PrismaApprovalRepository(transaction as unknown as PrismaClient).findApprovalLog(logId))!;
    });
  }

  async listPending(leaderId: string) {
    const steps = await this.database.approvalStep.findMany({
      where: { approverId: leaderId, status: "PENDING" },
      include: { dailyLog: true },
      orderBy: [{ dailyLog: { workDate: "asc" } }, { position: "asc" }]
    });
    const results: ApprovalLogRecord[] = [];
    for (const step of steps) {
      if (step.submissionNumber !== step.dailyLog.submissionCount) continue;
      const log = await this.findApprovalLog(step.dailyLogId);
      if (log?.approvalSteps.find((item) => item.status === "PENDING")?.approverId === leaderId) {
        results.push(log);
      }
    }
    return results;
  }
}
