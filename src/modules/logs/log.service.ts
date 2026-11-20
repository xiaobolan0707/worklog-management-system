import type { AuthUserRecord } from "../auth/auth.repository.js";
import type { ApproverService } from "../users/approver.service.js";
import type { LogDraftInput, LogListQuery, LogRepository } from "./log.repository.js";
import { beijingParts } from "../../shared/beijing-time.js";
import { logSubmissionItemsSchema } from "./log.schemas.js";

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

  /** FUNC-03：草稿与提交使用同一日期窗口，杜绝"能保存却永远无法提交"的僵尸草稿。 */
  private assertWorkDateInWindow(workDate: string, submissionCount = 0) {
    const today = beijingParts(this.now()).date;
    const offset = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${workDate}T00:00:00Z`)) / 86_400_000;
    if (!Number.isFinite(offset)) throw new LogError(400, "INVALID_WORK_DATE", "工作日期不合法");
    if (offset < 0) throw new LogError(400, "WORK_DATE_IN_FUTURE", "不能填写未来日期的日志");
    if (offset > 29 && submissionCount === 0) {
      throw new LogError(400, "BACKFILL_DATE_OUT_OF_RANGE", "补写日期超出最近30天，不可补写");
    }
  }

  createOrUpdateDraft(employeeId: string, input: LogDraftInput) {
    this.assertWorkDateInWindow(input.workDate);
    return this.repository.saveDraft(employeeId, input).catch((error: unknown) => {
      if (error instanceof Error && error.message === "LOG_NOT_EDITABLE") {
        throw new LogError(409, "LOG_ALREADY_EXISTS", "该日期已有日志，请勿重复补写");
      }
      throw error;
    });
  }

  async updateDraft(logId: string, employeeId: string, input: LogDraftInput) {
    const existing = await this.repository.findById(logId);
    if (existing && existing.employeeId === employeeId) {
      this.assertWorkDateInWindow(existing.workDate, existing.submissionCount);
    }
    const log = await this.repository.updateOwnedDraft(logId, employeeId, input);
    if (!log) throw new LogError(403, "LOG_NOT_EDITABLE", "只能修改本人的草稿或已退回日志");
    return log;
  }

  /** FUNC-03：允许员工清理本人的无效草稿，已提交/已归档日志不可删除。 */
  async deleteDraft(logId: string, employeeId: string) {
    const deleted = await this.repository.deleteOwnedDraft(logId, employeeId);
    if (deleted === "NOT_FOUND") throw new LogError(404, "LOG_NOT_FOUND", "草稿不存在或已被删除");
    if (deleted === "FORBIDDEN") throw new LogError(403, "FORBIDDEN", "只能删除本人的草稿");
    if (deleted === "NOT_DRAFT") throw new LogError(409, "LOG_NOT_DELETABLE", "仅草稿状态的日志可以删除");
  }

  async listVersions(actor: AuthUserRecord, logId: string) {
    await this.getVisibleLog(actor, logId);
    return this.repository.listVersions(logId);
  }

  async submitLog(logId: string, employeeId: string, backfillReason?: string) {
    const log = await this.repository.findById(logId);
    if (!log || log.employeeId !== employeeId) throw new LogError(403, "LOG_NOT_EDITABLE", "无权提交此日志");
    const today = beijingParts(this.now()).date;
    const offset = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${log.workDate}T00:00:00Z`)) / 86_400_000;
    if (offset < 0 || (offset > 29 && log.submissionCount === 0)) {
      throw new LogError(400, "BACKFILL_DATE_OUT_OF_RANGE", "补写日期超出最近30天，不可补写");
    }
    // INFO-03：先校验内容完整性，再校验补写原因，避免错误提示误导用户。
    const contentCheck = logSubmissionItemsSchema.safeParse(log.items.map((item) => ({
      content: item.content,
      completed: item.completed,
      unfinishedReason: item.unfinishedReason ?? undefined,
      images: item.images
    })));
    if (!contentCheck.success) {
      throw new LogError(400, "INVALID_LOG", "日志每项工作内容至少需要填写20字");
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

  /** PERF-03：按图片 id 单独取图，供待审列表按需加载，避免列表内联 base64 拖垮响应体。 */
  async getItemImage(actor: AuthUserRecord, logId: string, imageId: string) {
    const log = await this.getVisibleLog(actor, logId);
    for (const item of log.items) {
      const image = item.images.find((candidate) => candidate.id === imageId);
      if (image) return image;
    }
    throw new LogError(404, "IMAGE_NOT_FOUND", "图片不存在");
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
