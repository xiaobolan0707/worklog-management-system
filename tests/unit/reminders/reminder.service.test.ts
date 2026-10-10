import { describe, expect, it } from "vitest";

import { ReminderService } from "../../../src/modules/reminders/reminder.service.js";
import { InMemoryReminderRepository } from "../../support/in-memory-reminder-repository.js";

describe("ReminderService", () => {
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
