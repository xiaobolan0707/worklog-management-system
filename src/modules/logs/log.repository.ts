import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { appendAudit } from "../audit/audit.repository.js";
import { logSubmissionItemsSchema, type LogImagePayload } from "./log.schemas.js";

export type LogStatusValue = "DRAFT" | "SUBMITTED" | "IN_REVIEW" | "RETURNED" | "ARCHIVED";
export type LogColorValue = "GREEN" | "RED" | "GRAY";

export interface LogDraftInput {
  workDate: string;
  planTarget?: string | null | undefined;
  planDueAt?: string | null | undefined;
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

export interface ItemCommentReplyRecord {
  id: string;
  itemPosition: number;
  content: string;
  createdAt: string;
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
  planTarget: string | null;
  planDueAt: string | null;
  items: {
    position: number;
    content: string;
    completed: boolean;
    unfinishedReason?: string | null | undefined;
    images: LogImagePayload[];
  }[];
  approvalSteps: {
    id: string;
    submissionNumber?: number;
    approverId: string;
    approverName: string;
    approverRole: string;
    position: number;
    status: string;
    color: "RED" | "GRAY" | null;
    comment: string | null;
    itemComments: ItemCommentRecord[];
    replies: ItemCommentReplyRecord[];
    actedAt: string | null;
  }[];
  versions: unknown[];
}

export type SubmitLogResult = DailyLogRecord | "CONFLICT" | "NO_APPROVERS" | "INVALID" | null;

export interface LogListQuery { page: number; pageSize: number; search: string }
export interface LogSummary {
  id: string;
  employeeId: string;
  employeeName: string;
  workDate: string;
  status: LogStatusValue;
  color: LogColorValue | null;
  planTarget: string | null;
  planDueAt: string | null;
}
export interface LogListResult { logs: LogSummary[]; total: number; page: number; pageSize: number }

export interface LogRepository {
  saveDraft(employeeId: string, input: LogDraftInput): Promise<DailyLogRecord>;
  updateOwnedDraft(logId: string, employeeId: string, input: LogDraftInput): Promise<DailyLogRecord | null>;
  submitOwnedLog(logId: string, employeeId: string): Promise<SubmitLogResult>;
  findById(logId: string): Promise<DailyLogRecord | null>;
  addCommentReply(logId: string, employeeId: string, stepId: string, itemPosition: number, content: string): Promise<DailyLogRecord | null>;
  listScoped(employeeIds: string[] | null, query: LogListQuery): Promise<LogListResult>;
}

const includeLog = {
  employee: { select: { displayName: true, username: true } },
  items: { orderBy: { position: "asc" as const } },
  approvalSteps: {
    orderBy: { position: "asc" as const },
    include: {
      approver: { select: { displayName: true, username: true, role: true } },
      replies: { orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }] }
    }
  },
  versions: { orderBy: { versionNumber: "asc" as const } }
};

const selectSummary = {
  id: true, employeeId: true, workDate: true, status: true, color: true,
  planTarget: true, planDueAt: true,
  employee: { select: { displayName: true, username: true } }
} as const;

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
    planTarget: log.planTarget,
    planDueAt: log.planDueAt?.toISOString() ?? null,
    items: log.items.map((item) => ({
      position: item.position,
      content: item.content,
      completed: item.completed,
      unfinishedReason: item.unfinishedReason,
      images: jsonArray<LogImagePayload>(item.images)
    })),
    approvalSteps: log.approvalSteps.map((step) => ({
      id: step.id,
      submissionNumber: step.submissionNumber,
      approverId: step.approverId,
      approverName: step.approver.displayName ?? step.approver.username,
      approverRole: step.approver.role,
      position: step.position,
      status: step.status,
      color: step.color === "GREEN" ? null : step.color,
      comment: step.comment,
      itemComments: jsonArray<ItemCommentRecord>(step.itemComments),
      replies: step.replies.map((reply) => ({
        id: reply.id, itemPosition: reply.itemPosition,
        content: reply.content, createdAt: reply.createdAt.toISOString()
      })),
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
            data: {
              ...(input.planTarget !== undefined ? { planTarget: input.planTarget || null } : {}),
              ...(input.planDueAt !== undefined
                ? { planDueAt: input.planDueAt ? new Date(input.planDueAt) : null }
                : {}),
              version: { increment: 1 }
            }
          })
        : await transaction.dailyLog.create({
            data: {
              employeeId,
              workDate,
              planTarget: input.planTarget || null,
              planDueAt: input.planDueAt ? new Date(input.planDueAt) : null
            }
          });
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

  async addCommentReply(logId: string, employeeId: string, stepId: string, itemPosition: number, content: string) {
    const created = await this.database.$transaction(async (transaction) => {
      const step = await transaction.approvalStep.findFirst({
        where: { id: stepId, dailyLogId: logId, dailyLog: { employeeId } },
        select: { approverId: true, itemComments: true, status: true }
      });
      if (!step || !["APPROVED", "RETURNED", "SUPERSEDED"].includes(step.status) ||
        !jsonArray<ItemCommentRecord>(step.itemComments).some((item) => item.itemPosition === itemPosition)) return false;
      const reply = await transaction.itemCommentReply.create({
        data: { approvalStepId: stepId, itemPosition, content }
      });
      await transaction.reminder.create({
        data: {
          recipientId: step.approverId, kind: "COMMENT_REPLY", deduplicationKey: reply.id,
          title: "员工回复了您的批注", body: `员工回复了第 ${itemPosition} 项工作的批注。`, relatedLogId: logId
        }
      });
      await appendAudit(transaction, {
        actorId: employeeId, subjectUserId: employeeId, action: "COMMENT_REPLIED",
        entityType: "ItemCommentReply", entityId: reply.id,
        metadata: { logId, stepId, itemPosition }
      });
      return true;
    });
    return created ? this.findById(logId) : null;
  }

  async listScoped(employeeIds: string[] | null, query: LogListQuery): Promise<LogListResult> {
    const search = query.search.trim();
    const searchDate = /^\d{4}-\d{2}-\d{2}$/.test(search) ? new Date(`${search}T00:00:00.000Z`) : null;
    const where: Prisma.DailyLogWhereInput = {
      ...(employeeIds === null ? {} : { employeeId: { in: employeeIds } }),
      ...(search ? { OR: [
        { employeeId: search },
        { employee: { is: { username: { contains: search, mode: "insensitive" } } } },
        { employee: { is: { displayName: { contains: search, mode: "insensitive" } } } },
        ...(searchDate && !Number.isNaN(searchDate.getTime()) && searchDate.toISOString().slice(0, 10) === search
          ? [{ workDate: searchDate }] : [])
      ] } : {})
    };
    const logs = await this.database.dailyLog.findMany({
      where,
      orderBy: [{ workDate: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: selectSummary
    });
    const total = await this.database.dailyLog.count({ where });
    return {
      logs: logs.map((log) => ({
        id: log.id, employeeId: log.employeeId,
        employeeName: log.employee.displayName ?? log.employee.username,
        workDate: formatDate(log.workDate), status: log.status, color: log.color,
        planTarget: log.planTarget, planDueAt: log.planDueAt?.toISOString() ?? null
      })),
      total, page: query.page, pageSize: query.pageSize
    };
  }
}
