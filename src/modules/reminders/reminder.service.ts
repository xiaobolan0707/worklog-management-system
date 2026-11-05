import type { PrismaClient } from "../../generated/prisma/client.js";

export type ReminderKindValue =
  | "LOG_DUE"
  | "LOG_OVERDUE"
  | "APPROVAL_ASSIGNED"
  | "APPROVAL_OVERDUE"
  | "LOG_RETURNED"
  | "APPROVAL_COMPLETED"
  | "COMMENT_REPLY"
  | "ARCHIVE_OVERDUE"
  | "HR_SUBMISSION"
  | "HR_APPROVAL";

export interface ReminderInput {
  recipientId: string;
  kind: ReminderKindValue;
  deduplicationKey: string;
  title: string;
  body: string;
  relatedLogId?: string | null | undefined;
}

export interface ReminderRecord extends ReminderInput {
  id: string;
  readAt: Date | null;
  createdAt: Date;
}

export interface ReminderRepository {
  createDeduplicated(input: ReminderInput): Promise<ReminderRecord>;
  listForRecipient(recipientId: string, onlyArchive?: boolean): Promise<ReminderRecord[]>;
  markRead(recipientId: string, reminderId: string, readAt: Date): Promise<ReminderRecord | null>;
  listMissingEmployeeIds(workDate: string): Promise<string[]>;
  listOverdueApprovalLeaderIds(now: Date): Promise<string[]>;
}

export class ReminderError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
  }
}

const eventCopy: Record<
  Extract<ReminderKindValue, "APPROVAL_ASSIGNED" | "LOG_RETURNED" | "APPROVAL_COMPLETED">,
  { title: string; body: string }
> = {
  APPROVAL_ASSIGNED: { title: "新的待审日志", body: "您有一条工作日志待审批。" },
  LOG_RETURNED: { title: "日志已退回", body: "您的工作日志已退回，请修改后重新提交。" },
  APPROVAL_COMPLETED: { title: "日志审批完成", body: "您的工作日志已完成全部审批。" }
};

export class ReminderService {
  constructor(
    private readonly repository: ReminderRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  create(input: ReminderInput) {
    return this.repository.createDeduplicated(input);
  }

  createEventReminder(input: {
    recipientId: string;
    kind: keyof typeof eventCopy;
    logId: string;
    eventKey: string;
  }) {
    const copy = eventCopy[input.kind];
    return this.create({
      recipientId: input.recipientId,
      kind: input.kind,
      deduplicationKey: `${input.logId}:${input.eventKey}`,
      title: copy.title,
      body: copy.body,
      relatedLogId: input.logId
    });
  }

  list(recipientId: string, onlyArchive = false) {
    return this.repository.listForRecipient(recipientId, onlyArchive);
  }

  async markRead(recipientId: string, reminderId: string) {
    const reminder = await this.repository.markRead(recipientId, reminderId, this.now());
    if (!reminder) throw new ReminderError(404, "REMINDER_NOT_FOUND", "提醒不存在");
    return reminder;
  }
}

export class PrismaReminderRepository implements ReminderRepository {
  constructor(private readonly database: PrismaClient) {}

  async createDeduplicated(input: ReminderInput): Promise<ReminderRecord> {
    return this.database.reminder.upsert({
      where: {
        recipientId_kind_deduplicationKey: {
          recipientId: input.recipientId,
          kind: input.kind,
          deduplicationKey: input.deduplicationKey
        }
      },
      create: {
        ...input,
        relatedLogId: input.relatedLogId ?? null
      },
      update: {}
    });
  }

  listForRecipient(recipientId: string, onlyArchive = false): Promise<ReminderRecord[]> {
    return this.database.reminder.findMany({
      where: { recipientId, ...(onlyArchive ? { kind: "ARCHIVE_OVERDUE" as const } : {}), OR: [{ relatedLogId: null }, { relatedLog: { employee: { recycledAt: null, archivePurgingAt: null, archivePurgedAt: null } } }] },
      orderBy: { createdAt: "desc" }
    });
  }

  async markRead(recipientId: string, reminderId: string, readAt: Date) {
    const changed = await this.database.reminder.updateMany({
      where: { id: reminderId, recipientId },
      data: { readAt }
    });
    if (changed.count !== 1) return null;
    return this.database.reminder.findUnique({ where: { id: reminderId } });
  }

  async listMissingEmployeeIds(workDate: string) {
    const date = new Date(`${workDate}T00:00:00.000Z`);
    const users = await this.database.user.findMany({
      where: {
        role: "EMPLOYEE",
        accountStatus: "ACTIVE",
        employmentStatus: "ACTIVE", deletedAt: null, recycledAt: null, archivePurgingAt: null, archivePurgedAt: null,
        AND: [{ OR: [{ hireDate: null }, { hireDate: { lte: date } }] }, { OR: [{ departureDate: null }, { departureDate: { gt: date } }] }],
        dailyLogs: { none: { workDate: date, status: { not: "DRAFT" } } }
      },
      select: { id: true }
    });
    return users.map((user) => user.id);
  }

  async listOverdueApprovalLeaderIds(now: Date) {
    const threshold = new Date(now.getTime() - 72 * 60 * 60 * 1000);
    const steps = await this.database.approvalStep.findMany({
      where: { status: "PENDING", approver: { accountStatus: "ACTIVE", employmentStatus: "ACTIVE", recycledAt: null, archivePurgingAt: null, archivePurgedAt: null }, dailyLog: { employee: { recycledAt: null, archivePurgingAt: null, archivePurgedAt: null }, submittedAt: { lte: threshold }, status: { in: ["SUBMITTED", "IN_REVIEW"] } } },
      select: {
        approverId: true, dailyLogId: true, position: true, submissionNumber: true,
        dailyLog: { select: { submissionCount: true } }
      },
      orderBy: [{ dailyLogId: "asc" }, { position: "asc" }]
    });
    const currentLogs = new Set<string>();
    const leaders = new Set<string>();
    for (const step of steps) {
      if (step.submissionNumber !== step.dailyLog.submissionCount || currentLogs.has(step.dailyLogId)) continue;
      currentLogs.add(step.dailyLogId);
      leaders.add(step.approverId);
    }
    return [...leaders];
  }
}
