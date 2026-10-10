import type { PrismaClient } from "../../generated/prisma/client.js";
import { appendAudit } from "../audit/audit.repository.js";

export interface ApprovalStepRecord {
  approverId: string;
  position: number;
  status: string;
  color?: "RED" | "GRAY" | null;
  comment?: string | null;
}

export interface ApprovalLogRecord {
  id: string;
  employeeId: string;
  workDate: string;
  status: string;
  color: "GREEN" | "RED" | "GRAY" | null;
  version: number;
  approvalSteps: ApprovalStepRecord[];
}

export type ApprovalResult = ApprovalLogRecord | "NOT_FOUND" | "CONFLICT";

export interface ApprovalRepository {
  findApprovalLog(logId: string): Promise<ApprovalLogRecord | null>;
  approve(logId: string, leaderId: string, color: "RED" | "GRAY", comment: string): Promise<ApprovalResult>;
  returnLog(logId: string, leaderId: string, comment: string): Promise<ApprovalResult>;
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
    if (log.workDate !== beijingDate(this.now())) {
      throw new ApprovalError(409, "APPROVAL_DATE_EXPIRED", "该日志已超过当日审批时间");
    }
    return log;
  }

  async approveCurrentStep(
    logId: string,
    leaderId: string,
    color: "RED" | "GRAY",
    comment: string
  ) {
    if (color !== "RED" && color !== "GRAY") {
      throw new ApprovalError(400, "INVALID_COLOR", "审批只能选择红色或灰色");
    }
    await this.assertCurrent(logId, leaderId);
    const result = await this.repository.approve(logId, leaderId, color, comment.trim());
    if (result === "CONFLICT") {
      throw new ApprovalError(409, "APPROVAL_CONFLICT", "日志已被处理，请刷新");
    }
    if (result === "NOT_FOUND") throw new ApprovalError(403, "FORBIDDEN", "无权操作此日志");
    return result;
  }

  async returnCurrentStep(logId: string, leaderId: string, comment: string) {
    if (!comment.trim()) throw new ApprovalError(400, "RETURN_REASON_REQUIRED", "退回时必须填写原因");
    await this.assertCurrent(logId, leaderId);
    const result = await this.repository.returnLog(logId, leaderId, comment.trim());
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

export class PrismaApprovalRepository implements ApprovalRepository {
  constructor(private readonly database: PrismaClient) {}

  async findApprovalLog(logId: string) {
    const log = await this.database.dailyLog.findUnique({
      where: { id: logId },
      include: { approvalSteps: { orderBy: { position: "asc" } } }
    });
    if (!log) return null;
    const steps = log.approvalSteps.filter((step) => step.submissionNumber === log.submissionCount);
    return {
      id: log.id,
      employeeId: log.employeeId,
      workDate: dateText(log.workDate),
      status: log.status,
      color: log.color,
      version: log.version,
      approvalSteps: steps.map((step) => ({
        approverId: step.approverId,
        position: step.position,
        status: step.status,
        color: step.color === "GREEN" ? null : step.color,
        comment: step.comment
      }))
    };
  }

  async approve(logId: string, leaderId: string, color: "RED" | "GRAY", comment: string) {
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
        data: { status: "APPROVED", color, comment, actedAt: new Date() }
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
        metadata: { color, position: current.position, final }
      });
      return (await new PrismaApprovalRepository(transaction as unknown as PrismaClient).findApprovalLog(logId))!;
    });
  }

  async returnLog(logId: string, leaderId: string, comment: string) {
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
        data: { status: "RETURNED", comment, actedAt: new Date() }
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
        metadata: { reason: comment }
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
