import type { AuthUserRecord } from "../auth/auth.repository.js";
import type { ApproverService } from "../users/approver.service.js";
import type { LogDraftInput, LogRepository } from "./log.repository.js";

export class LogError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
  }
}

export class LogService {
  constructor(
    private readonly repository: LogRepository,
    private readonly approverService: ApproverService
  ) {}

  createOrUpdateDraft(employeeId: string, input: LogDraftInput) {
    return this.repository.saveDraft(employeeId, input);
  }

  async updateDraft(logId: string, employeeId: string, input: LogDraftInput) {
    const log = await this.repository.updateOwnedDraft(logId, employeeId, input);
    if (!log) throw new LogError(403, "LOG_NOT_EDITABLE", "只能修改本人的草稿或已退回日志");
    return log;
  }

  async submitLog(logId: string, employeeId: string) {
    const result = await this.repository.submitOwnedLog(logId, employeeId);
    if (result === "CONFLICT") throw new LogError(409, "LOG_ALREADY_SUBMITTED", "日志已提交");
    if (result === "NO_APPROVERS") throw new LogError(409, "NO_APPROVERS", "管理员尚未配置审批人");
    if (result === "INVALID") throw new LogError(400, "INVALID_LOG", "日志至少需要四项有效工作内容");
    if (!result) throw new LogError(403, "LOG_NOT_EDITABLE", "无权提交此日志");
    return result;
  }

  resubmitReturnedLog(logId: string, employeeId: string) {
    return this.submitLog(logId, employeeId);
  }

  listMine(employeeId: string) {
    return this.repository.listMine(employeeId);
  }

  async getVisibleLog(actor: AuthUserRecord, logId: string) {
    const log = await this.repository.findById(logId);
    if (!log) throw new LogError(404, "LOG_NOT_FOUND", "日志不存在");
    if (actor.role === "EMPLOYEE" && log.employeeId !== actor.id) {
      throw new LogError(403, "FORBIDDEN", "无权查看此日志");
    }
    if (actor.role === "LEADER") {
      const allowed = await this.approverService.listAuthorizedEmployeeIds(actor.id);
      if (!allowed.includes(log.employeeId)) {
        throw new LogError(403, "FORBIDDEN", "无权查看此日志");
      }
    }
    return log;
  }

  async listVisible(actor: AuthUserRecord) {
    if (actor.role === "EMPLOYEE") return this.repository.listMine(actor.id);
    if (actor.role === "LEADER") {
      return this.repository.listScoped(
        await this.approverService.listAuthorizedEmployeeIds(actor.id)
      );
    }
    return this.repository.listScoped(null);
  }
}
