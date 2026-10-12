import type { PrismaClient } from "../../generated/prisma/client.js";
import { appendAudit } from "../audit/audit.repository.js";
import { logSubmissionItemsSchema, type LogImagePayload } from "./log.schemas.js";

export type LogStatusValue = "DRAFT" | "SUBMITTED" | "IN_REVIEW" | "RETURNED" | "ARCHIVED";
export type LogColorValue = "GREEN" | "RED" | "GRAY";

export interface LogDraftInput {
  workDate: string;
  items: {
    content: string;
    completed: boolean;
    unfinishedReason?: string | undefined;
    images: LogImagePayload[];
  }[];
}

export interface ItemCommentRecord {
  itemPosition: number;
  comment: string;
}

export interface DailyLogRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  workDate: string;
  status: LogStatusValue;
  color: LogColorValue | null;
  version: number;
  submissionCount: number;
  items: {
    position: number;
    content: string;
    completed: boolean;
    unfinishedReason?: string | null | undefined;
    images: LogImagePayload[];
  }[];
  approvalSteps: {
    approverId: string;
    approverName: string;
    approverRole: string;
    position: number;
    status: string;
    color: "RED" | "GRAY" | null;
    comment: string | null;
    itemComments: ItemCommentRecord[];
    actedAt: string | null;
  }[];
  versions: unknown[];
}

export type SubmitLogResult = DailyLogRecord | "CONFLICT" | "NO_APPROVERS" | "INVALID" | null;

export interface LogRepository {
  saveDraft(employeeId: string, input: LogDraftInput): Promise<DailyLogRecord>;
  updateOwnedDraft(logId: string, employeeId: string, input: LogDraftInput): Promise<DailyLogRecord | null>;
  submitOwnedLog(logId: string, employeeId: string): Promise<SubmitLogResult>;
  findById(logId: string): Promise<DailyLogRecord | null>;
  listMine(employeeId: string): Promise<DailyLogRecord[]>;
  listScoped(employeeIds: string[] | null): Promise<DailyLogRecord[]>;
}

const includeLog = {
  employee: { select: { displayName: true, username: true } },
  items: { orderBy: { position: "asc" as const } },
  approvalSteps: {
    orderBy: { position: "asc" as const },
    include: { approver: { select: { displayName: true, username: true, role: true } } }
  },
  versions: { orderBy: { versionNumber: "asc" as const } }
};

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function jsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function toRecord(log: Awaited<ReturnType<PrismaLogRepository["load"]>>): DailyLogRecord {
  if (!log) throw new Error("Expected daily log");
  return {
    id: log.id,
    employeeId: log.employeeId,
    employeeName: log.employee.displayName ?? log.employee.username,
    workDate: formatDate(log.workDate),
    status: log.status,
    color: log.color,
    version: log.version,
    submissionCount: log.submissionCount,
    items: log.items.map((item) => ({
      position: item.position,
      content: item.content,
      completed: item.completed,
      unfinishedReason: item.unfinishedReason,
      images: jsonArray<LogImagePayload>(item.images)
    })),
    approvalSteps: log.approvalSteps.map((step) => ({
      approverId: step.approverId,
      approverName: step.approver.displayName ?? step.approver.username,
      approverRole: step.approver.role,
      position: step.position,
      status: step.status,
      color: step.color === "GREEN" ? null : step.color,
      comment: step.comment,
      itemComments: jsonArray<ItemCommentRecord>(step.itemComments),
      actedAt: step.actedAt?.toISOString() ?? null
    })),
    versions: log.versions.map((version) => version.snapshot)
  };
}

export class PrismaLogRepository implements LogRepository {
  constructor(private readonly database: PrismaClient) {}

  private load(id: string) {
    return this.database.dailyLog.findUnique({ where: { id }, include: includeLog });
  }

  async saveDraft(employeeId: string, input: LogDraftInput) {
    const workDate = new Date(`${input.workDate}T00:00:00.000Z`);
    const log = await this.database.$transaction(async (transaction) => {
      const existing = await transaction.dailyLog.findUnique({
        where: { employeeId_workDate: { employeeId, workDate } }
      });
      if (existing && !["DRAFT", "RETURNED"].includes(existing.status)) {
        throw new Error("LOG_NOT_EDITABLE");
      }
      const saved = existing
        ? await transaction.dailyLog.update({
            where: { id: existing.id },
            data: { version: { increment: 1 } }
          })
        : await transaction.dailyLog.create({ data: { employeeId, workDate } });
      await transaction.logItem.deleteMany({ where: { dailyLogId: saved.id } });
      await transaction.logItem.createMany({
        data: input.items.map((item, index) => ({
          dailyLogId: saved.id,
          position: index + 1,
          content: item.content,
          completed: item.completed,
          unfinishedReason: item.unfinishedReason || null,
          images: item.images
        }))
      });
      return saved.id;
    });
    return toRecord(await this.load(log));
  }

  async updateOwnedDraft(logId: string, employeeId: string, input: LogDraftInput) {
    const existing = await this.load(logId);
    if (!existing || existing.employeeId !== employeeId || !["DRAFT", "RETURNED"].includes(existing.status)) {
      return null;
    }
    return this.saveDraft(employeeId, { ...input, workDate: formatDate(existing.workDate) });
  }

  async submitOwnedLog(logId: string, employeeId: string): Promise<SubmitLogResult> {
    return this.database.$transaction(async (transaction) => {
      const log = await transaction.dailyLog.findUnique({
        where: { id: logId },
        include: { items: { orderBy: { position: "asc" } } }
      });
      if (!log || log.employeeId !== employeeId) return null;
      if (!["DRAFT", "RETURNED"].includes(log.status)) return "CONFLICT";
      const parsedItems = logSubmissionItemsSchema.safeParse(log.items.map((item) => ({
        content: item.content,
        completed: item.completed,
        unfinishedReason: item.unfinishedReason ?? undefined,
        images: jsonArray<LogImagePayload>(item.images)
      })));
      if (!parsedItems.success) return "INVALID";
      const approvers = await transaction.employeeApprover.findMany({
        where: { employeeId, active: true },
        orderBy: { position: "asc" }
      });
      if (approvers.length === 0) return "NO_APPROVERS";
      const changed = await transaction.dailyLog.updateMany({
        where: { id: logId, version: log.version, status: { in: ["DRAFT", "RETURNED"] } },
        data: {
          status: "SUBMITTED",
          color: "GREEN",
          submittedAt: new Date(),
          submissionCount: { increment: 1 },
          version: { increment: 1 }
        }
      });
      if (changed.count !== 1) return "CONFLICT";
      await transaction.logVersion.create({
        data: {
          dailyLogId: logId,
          versionNumber: log.version,
          createdById: employeeId,
          snapshot: log.items.map((item) => ({
            position: item.position,
            content: item.content,
            completed: item.completed,
            unfinishedReason: item.unfinishedReason,
            images: jsonArray<LogImagePayload>(item.images)
          }))
        }
      });
      await transaction.approvalStep.createMany({
        data: approvers.map((assignment) => ({
          dailyLogId: logId,
          approverId: assignment.approverId,
          position: assignment.position,
          submissionNumber: log.submissionCount + 1
        }))
      });
      await appendAudit(transaction, {
        actorId: employeeId,
        subjectUserId: employeeId,
        action: "LOG_SUBMITTED",
        entityType: "DailyLog",
        entityId: logId,
        metadata: { workDate: formatDate(log.workDate) }
      });
      const saved = await transaction.dailyLog.findUnique({ where: { id: logId }, include: includeLog });
      return toRecord(saved);
    });
  }

  async findById(logId: string) {
    const log = await this.load(logId);
    return log ? toRecord(log) : null;
  }

  async listMine(employeeId: string) {
    const logs = await this.database.dailyLog.findMany({
      where: { employeeId },
      orderBy: { workDate: "desc" },
      include: includeLog
    });
    return logs.map(toRecord);
  }

  async listScoped(employeeIds: string[] | null) {
    const logs = await this.database.dailyLog.findMany({
      where: employeeIds === null ? {} : { employeeId: { in: employeeIds } },
      orderBy: { workDate: "desc" },
      include: includeLog
    });
    return logs.map(toRecord);
  }
}
