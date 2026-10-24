import { randomUUID } from "node:crypto";
import type {
  DailyLogRecord,
  LogDraftInput,
  LogRepository,
  LogStatusValue
} from "../../src/modules/logs/log.repository.js";
import { logSubmissionItemsSchema } from "../../src/modules/logs/log.schemas.js";
import type { ReminderRepository } from "../../src/modules/reminders/reminder.service.js";

export class InMemoryLogRepository implements LogRepository {
  constructor(private readonly reminders?: ReminderRepository) {}
  readonly logs = new Map<string, DailyLogRecord>();
  readonly approvers = new Map<string, { approverId: string; position: number }[]>();
  readonly audits: { action: string; entityId: string }[] = [];

  async saveDraft(employeeId: string, input: LogDraftInput) {
    const existing = [...this.logs.values()].find(
      (log) => log.employeeId === employeeId && log.workDate === input.workDate
    );
    if (existing) {
      existing.items = input.items.map((item, index) => ({ ...item, position: index + 1 }));
      if (input.planTarget !== undefined) existing.planTarget = input.planTarget || null;
      if (input.planDueAt !== undefined) existing.planDueAt = input.planDueAt;
      existing.status = existing.status === "RETURNED" ? "RETURNED" : "DRAFT";
      existing.version += 1;
      return existing;
    }
    const log: DailyLogRecord = {
      id: `log-${this.logs.size + 1}`,
      employeeId,
      employeeName: employeeId,
      workDate: input.workDate,
      status: "DRAFT",
      color: null,
      version: 0,
      submissionCount: 0,
      planTarget: input.planTarget || null,
      planDueAt: input.planDueAt ?? null,
      items: input.items.map((item, index) => ({ ...item, position: index + 1 })),
      approvalSteps: [],
      versions: []
    };
    this.logs.set(log.id, log);
    return log;
  }

  async updateOwnedDraft(logId: string, employeeId: string, input: LogDraftInput) {
    const log = this.logs.get(logId);
    if (!log || log.employeeId !== employeeId || !["DRAFT", "RETURNED"].includes(log.status)) {
      return null;
    }
    log.versions.push({ version: log.version, items: structuredClone(log.items) });
    log.items = input.items.map((item, index) => ({ ...item, position: index + 1 }));
    if (input.planTarget !== undefined) log.planTarget = input.planTarget || null;
    if (input.planDueAt !== undefined) log.planDueAt = input.planDueAt;
    log.version += 1;
    return log;
  }

  async submitOwnedLog(logId: string, employeeId: string) {
    const log = this.logs.get(logId);
    if (!log || log.employeeId !== employeeId) return null;
    if (!(["DRAFT", "RETURNED"] as LogStatusValue[]).includes(log.status)) return "CONFLICT" as const;
    if (!logSubmissionItemsSchema.safeParse(log.items).success) return "INVALID" as const;
    const assignments = this.approvers.get(employeeId) ?? [];
    if (assignments.length === 0) return "NO_APPROVERS" as const;
    log.versions.push({ version: log.version, items: structuredClone(log.items) });
    log.status = "SUBMITTED";
    log.color = "GREEN";
    log.submissionCount += 1;
    log.version += 1;
    log.approvalSteps = assignments.map((assignment) => ({
      ...assignment,
      id: `step-${log.submissionCount}-${assignment.position}`,
      submissionNumber: log.submissionCount,
      approverName: assignment.approverId,
      approverRole: "LEADER",
      status: "PENDING",
      color: null,
      comment: null,
      itemComments: [],
      replies: [],
      actedAt: null
    }));
    this.audits.push({ action: "LOG_SUBMITTED", entityId: log.id });
    return log;
  }

  async findById(logId: string) {
    return this.logs.get(logId) ?? null;
  }

  async addCommentReply(logId: string, employeeId: string, stepId: string, itemPosition: number, content: string) {
    const log = this.logs.get(logId);
    const step = log?.approvalSteps.find((item) => item.id === stepId);
    if (!step || log?.employeeId !== employeeId ||
      !step.itemComments.some((item) => item.itemPosition === itemPosition)) return null;
    const id = randomUUID();
    step.replies.push({ id, itemPosition, content, createdAt: new Date().toISOString() });
    await this.reminders?.createDeduplicated({
      recipientId: step.approverId, kind: "COMMENT_REPLY", deduplicationKey: id,
      title: "员工回复了您的批注", body: `员工回复了第 ${itemPosition} 项工作的批注。`, relatedLogId: logId
    });
    return log;
  }

  async listScoped(employeeIds: string[] | null, query: { page: number; pageSize: number; search: string }) {
    const matches = [...this.logs.values()].filter(
      (log) => employeeIds === null || employeeIds.includes(log.employeeId)
    ).filter((log) => !query.search || log.employeeName.includes(query.search) || log.workDate.includes(query.search));
    return {
      logs: matches.slice((query.page - 1) * query.pageSize, query.page * query.pageSize).map((log) => ({
        id: log.id, employeeId: log.employeeId, employeeName: log.employeeName,
        workDate: log.workDate, status: log.status, color: log.color,
        planTarget: log.planTarget, planDueAt: log.planDueAt
      })),
      total: matches.length, page: query.page, pageSize: query.pageSize
    };
  }
}
