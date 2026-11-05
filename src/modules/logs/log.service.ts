import type { AuthUserRecord } from "../auth/auth.repository.js";
import type { ApproverService } from "../users/approver.service.js";
import type { LogDraftInput, LogListQuery, LogRepository } from "./log.repository.js";
import { beijingParts } from "../../shared/beijing-time.js";

export class LogError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
  }
}

export class LogService {
  constructor(
    private readonly repository: LogRepository,
    private readonly approverService: ApproverService,
    private readonly now: () => Date = () => new Date()
  ) {}

  createOrUpdateDraft(employeeId: string, input: LogDraftInput) {
    return this.repository.saveDraft(employeeId, input).catch((error: unknown) => {
      if (error instanceof Error && error.message === "LOG_NOT_EDITABLE") {
        throw new LogError(409, "LOG_ALREADY_EXISTS", "该日期已有日志，请勿重复补写");
      }
      throw error;
    });
  }

  async updateDraft(logId: string, employeeId: string, input: LogDraftInput) {
    const log = await this.repository.updateOwnedDraft(logId, employeeId, input);
    if (!log) throw new LogError(403, "LOG_NOT_EDITABLE", "只能修改本人的草稿或已退回日志");
    return log;
  }

  async submitLog(logId: string, employeeId: string, backfillReason?: string) {
    const log = await this.repository.findById(logId);
    if (!log || log.employeeId !== employeeId) throw new LogError(403, "LOG_NOT_EDITABLE", "无权提交此日志");
    const today = beijingParts(this.now()).date;
    const offset = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${log.workDate}T00:00:00Z`)) / 86_400_000;
    if (offset < 0 || (offset > 29 && log.submissionCount === 0)) {
      throw new LogError(400, "BACKFILL_DATE_OUT_OF_RANGE", "补写日期超出最近30天，不可补写");
    }
    const reason = backfillReason?.trim();
    const isBackfill = log.submissionCount === 0 && (offset > 0 || Boolean(reason));
    if (isBackfill && (!reason || reason.length > 100)) {
      throw new LogError(400, "BACKFILL_REASON_REQUIRED", "补写原因必填且不超过100字");
    }
    const result = await this.repository.submitOwnedLog(logId, employeeId, isBackfill ? reason : undefined, this.now());
    if (result === "CONFLICT") throw new LogError(409, "LOG_ALREADY_SUBMITTED", "该日期已有日志，请勿重复补写");
    if (result === "NO_APPROVERS") throw new LogError(409, "NO_APPROVERS", "管理员尚未配置审批人");
    if (result === "INVALID") throw new LogError(400, "INVALID_LOG", "日志每项工作内容至少需要填写20字");
    if (!result) throw new LogError(403, "LOG_NOT_EDITABLE", "无权提交此日志");
    return result;
  }

  resubmitReturnedLog(logId: string, employeeId: string) {
    return this.submitLog(logId, employeeId);
  }

  async replyToComment(logId: string, employeeId: string, stepId: string, itemPosition: number, content: string) {
    const log = await this.repository.findById(logId);
    if (!log || log.employeeId !== employeeId) throw new LogError(403, "FORBIDDEN", "无权回复此日志");
    const step = log.approvalSteps.find((item) => item.id === stepId);
    if (!step || !["APPROVED", "RETURNED", "SUPERSEDED"].includes(step.status) ||
      !step.itemComments.some((item) => item.itemPosition === itemPosition)) {
      throw new LogError(404, "COMMENT_NOT_FOUND", "批注不存在");
    }
    const saved = await this.repository.addCommentReply(logId, employeeId, stepId, itemPosition, content);
    if (!saved) throw new LogError(409, "COMMENT_CHANGED", "批注已变化，请刷新重试");
    return saved;
  }

  listMine(employeeId: string, query: LogListQuery) {
    return this.repository.listScoped([employeeId], query);
  }

  async getVisibleLog(actor: AuthUserRecord, logId: string) {
    if (!["EMPLOYEE", "LEADER", "MANAGEMENT", "ADMIN"].includes(actor.role)) throw new LogError(403, "FORBIDDEN", "无权查看日志内容");
    const log = await this.repository.findById(logId);
    if (!log) throw new LogError(404, "LOG_NOT_FOUND", "日志不存在");
    if ((actor.role === "EMPLOYEE" || actor.employmentStatus === "DEPARTED") && log.employeeId !== actor.id) {
      throw new LogError(403, "FORBIDDEN", "无权查看此日志");
    }
    if (actor.role === "LEADER" && log.employeeId !== actor.id) {
      const allowed = await this.approverService.listAuthorizedEmployeeIds(actor.id);
      const previouslyCommented = log.approvalSteps.some((step) =>
        step.approverId === actor.id && step.itemComments.length > 0
      );
      if (!allowed.includes(log.employeeId) && !previouslyCommented) {
        throw new LogError(403, "FORBIDDEN", "无权查看此日志");
      }
    }
    return log;
  }

  async listVisible(actor: AuthUserRecord, query: LogListQuery) {
    if (!["EMPLOYEE", "LEADER", "MANAGEMENT", "ADMIN"].includes(actor.role)) throw new LogError(403, "FORBIDDEN", "无权查看日志内容");
    if (actor.role === "EMPLOYEE") return this.repository.listScoped([actor.id], query);
    if (actor.role === "LEADER") {
      return this.repository.listScoped(
        await this.approverService.listAuthorizedEmployeeIds(actor.id), query
      );
    }
    return this.repository.listScoped(null, query);
  }
}
