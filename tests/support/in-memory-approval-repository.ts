import type {
  ApprovalLogRecord,
  ApprovalRepository,
  ApprovalResult
} from "../../src/modules/approvals/approval.service.js";

export class InMemoryApprovalRepository implements ApprovalRepository {
  readonly logs = new Map<string, ApprovalLogRecord>();
  readonly audits: { action: string; entityId: string }[] = [];

  addSubmittedLog(input: {
    id: string;
    employeeId: string;
    workDate: string;
    approverIds: string[];
    items?: ApprovalLogRecord["items"];
  }) {
    this.logs.set(input.id, {
      id: input.id,
      employeeId: input.employeeId,
      workDate: input.workDate,
      status: "SUBMITTED",
      color: "GREEN",
      version: 1,
      items: input.items ?? [],
      approvalSteps: input.approverIds.map((approverId, index) => ({
        approverId,
        position: index + 1,
        status: "PENDING"
      }))
    });
  }

  async findApprovalLog(logId: string) {
    return this.logs.get(logId) ?? null;
  }

  async approve(logId: string, leaderId: string, color: "RED" | "GRAY", comment: string): Promise<ApprovalResult> {
    const log = this.logs.get(logId);
    if (!log) return "NOT_FOUND";
    const current = log.approvalSteps.find((step) => step.status === "PENDING");
    if (!current || current.approverId !== leaderId) return "CONFLICT";
    current.status = "APPROVED";
    current.color = color;
    current.comment = comment;
    log.color = color;
    log.version += 1;
    log.status = log.approvalSteps.some((step) => step.status === "PENDING")
      ? "IN_REVIEW"
      : "ARCHIVED";
    this.audits.push({ action: "LOG_APPROVED", entityId: logId });
    return log;
  }

  async returnLog(logId: string, leaderId: string, comment: string): Promise<ApprovalResult> {
    const log = this.logs.get(logId);
    if (!log) return "NOT_FOUND";
    const current = log.approvalSteps.find((step) => step.status === "PENDING");
    if (!current || current.approverId !== leaderId) return "CONFLICT";
    current.status = "RETURNED";
    current.comment = comment;
    log.status = "RETURNED";
    log.color = "GREEN";
    log.version += 1;
    this.audits.push({ action: "LOG_RETURNED", entityId: logId });
    return log;
  }

  async changeColor(logId: string, leaderId: string, color: "RED" | "GRAY", reason: string) {
    const log = this.logs.get(logId);
    if (!log || log.status !== "ARCHIVED") return null;
    if (!log.approvalSteps.some((step) => step.approverId === leaderId)) return "FORBIDDEN" as const;
    log.color = color;
    log.version += 1;
    this.audits.push({ action: "LOG_COLOR_CHANGED", entityId: logId });
    return log;
  }

  async listPending(leaderId: string) {
    return [...this.logs.values()].filter(
      (log) => log.approvalSteps.find((step) => step.status === "PENDING")?.approverId === leaderId
    );
  }
}
