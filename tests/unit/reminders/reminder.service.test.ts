import { describe, expect, it } from "vitest";

import { PrismaReminderRepository, ReminderService } from "../../../src/modules/reminders/reminder.service.js";
import { InMemoryReminderRepository } from "../../support/in-memory-reminder-repository.js";

describe("ReminderService", () => {
  it("finds overdue approvals from earlier work dates", async () => {
    const repository = new PrismaReminderRepository({
      approvalStep: {
        findMany: async ({ where }: { where: { dailyLog: { workDate: { lt?: Date } } } }) =>
          where.dailyLog.workDate.lt?.toISOString() === "2026-10-11T00:00:00.000Z"
            ? [{ approverId: "leader-yesterday", dailyLogId: "log-1", position: 1, submissionNumber: 1, dailyLog: { submissionCount: 1 } }]
            : []
      }
    } as never);
    await expect(repository.listOverdueApprovalLeaderIds("2026-10-11"))
      .resolves.toEqual(["leader-yesterday"]);
  });

  it("reminds only the current approver for an older pending log", async () => {
    const repository = new PrismaReminderRepository({
      approvalStep: { findMany: async () => [
        { approverId: "leader-first", dailyLogId: "log-1", position: 1, submissionNumber: 2, dailyLog: { submissionCount: 2 } },
        { approverId: "leader-next", dailyLogId: "log-1", position: 2, submissionNumber: 2, dailyLog: { submissionCount: 2 } },
        { approverId: "leader-old-round", dailyLogId: "log-2", position: 1, submissionNumber: 1, dailyLog: { submissionCount: 2 } }
      ] }
    } as never);
    await expect(repository.listOverdueApprovalLeaderIds("2026-10-11"))
      .resolves.toEqual(["leader-first"]);
  });

  it("creates event reminders for approval assignment, return, and completion", async () => {
    const repository = new InMemoryReminderRepository();
    const service = new ReminderService(repository);

    await service.createEventReminder({
      recipientId: "leader-1",
      kind: "APPROVAL_ASSIGNED",
      logId: "log-1",
      eventKey: "submission-1"
    });
    await service.createEventReminder({
      recipientId: "employee-1",
      kind: "LOG_RETURNED",
      logId: "log-1",
      eventKey: "return-1"
    });
    await service.createEventReminder({
      recipientId: "employee-1",
      kind: "APPROVAL_COMPLETED",
      logId: "log-1",
      eventKey: "complete-1"
    });

    expect(repository.reminders.map((item) => item.kind)).toEqual([
      "APPROVAL_ASSIGNED",
      "LOG_RETURNED",
      "APPROVAL_COMPLETED"
    ]);
  });

  it("isolates recipients and only lets the owner mark a reminder read", async () => {
    const repository = new InMemoryReminderRepository();
    const service = new ReminderService(repository, () => new Date("2026-10-10T01:00:00.000Z"));
    const reminder = await service.createEventReminder({
      recipientId: "employee-1",
      kind: "LOG_RETURNED",
      logId: "log-1",
      eventKey: "return-1"
    });

    await expect(service.markRead("employee-2", reminder.id)).rejects.toMatchObject({ code: "REMINDER_NOT_FOUND" });
    await expect(service.markRead("employee-1", reminder.id)).resolves.toMatchObject({
      readAt: new Date("2026-10-10T01:00:00.000Z")
    });
    await expect(service.list("employee-2")).resolves.toEqual([]);
  });
});
