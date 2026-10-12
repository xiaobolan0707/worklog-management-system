import type {
  DailyLogRecord,
  LogDraftInput,
  LogRepository,
  LogStatusValue
} from "../../src/modules/logs/log.repository.js";

export class InMemoryLogRepository implements LogRepository {
  readonly logs = new Map<string, DailyLogRecord>();
  readonly approvers = new Map<string, { approverId: string; position: number }[]>();
  readonly audits: { action: string; entityId: string }[] = [];

  async saveDraft(employeeId: string, input: LogDraftInput) {
    const existing = [...this.logs.values()].find(
      (log) => log.employeeId === employeeId && log.workDate === input.workDate
    );
    if (existing) {
      existing.items = input.items.map((item, index) => ({ ...item, position: index + 1 }));
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
    log.version += 1;
    return log;
  }

  async submitOwnedLog(logId: string, employeeId: string) {
    const log = this.logs.get(logId);
    if (!log || log.employeeId !== employeeId) return null;
    if (!(["DRAFT", "RETURNED"] as LogStatusValue[]).includes(log.status)) return "CONFLICT" as const;
    const assignments = this.approvers.get(employeeId) ?? [];
    if (assignments.length === 0) return "NO_APPROVERS" as const;
    log.versions.push({ version: log.version, items: structuredClone(log.items) });
    log.status = "SUBMITTED";
    log.color = "GREEN";
    log.submissionCount += 1;
    log.version += 1;
    log.approvalSteps = assignments.map((assignment) => ({
      ...assignment,
      approverName: assignment.approverId,
      approverRole: "LEADER",
      status: "PENDING",
      color: null,
      comment: null,
      itemComments: [],
      actedAt: null
    }));
    this.audits.push({ action: "LOG_SUBMITTED", entityId: log.id });
    return log;
  }

  async findById(logId: string) {
    return this.logs.get(logId) ?? null;
  }

  async listMine(employeeId: string) {
    return [...this.logs.values()].filter((log) => log.employeeId === employeeId);
  }

  async listScoped(employeeIds: string[] | null) {
    return [...this.logs.values()].filter(
      (log) => employeeIds === null || employeeIds.includes(log.employeeId)
    );
  }
}
