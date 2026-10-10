import { describe, expect, it } from "vitest";

import { ReminderJobs } from "../../../src/modules/reminders/reminder.jobs.js";
import { ReminderService } from "../../../src/modules/reminders/reminder.service.js";
import { InMemoryReminderRepository } from "../../support/in-memory-reminder-repository.js";

describe("submission reminder job", () => {
  it("creates warning and overdue reminders using Beijing time", async () => {
    const repository = new InMemoryReminderRepository();
    repository.missingEmployeeIds = ["employee-1"];
    repository.overdueApprovalLeaderIds = ["leader-1"];
    const jobs = new ReminderJobs(new ReminderService(repository), repository, {
      submissionDeadline: "18:00",
      reminderMinutesBefore: 30,
      approvalDeadline: "12:00",
      timezone: "Asia/Shanghai"
    });

    await jobs.runSubmissionReminderJob(new Date("2026-10-10T09:30:00.000Z"));
    await jobs.runSubmissionReminderJob(new Date("2026-10-10T10:01:00.000Z"));

    expect(repository.reminders.map((item) => item.kind)).toEqual([
      "LOG_DUE",
      "APPROVAL_OVERDUE",
      "LOG_OVERDUE"
    ]);
  });

  it("is idempotent when the same job is rerun after restart", async () => {
    const repository = new InMemoryReminderRepository();
    repository.missingEmployeeIds = ["employee-1"];
    const settings = {
      submissionDeadline: "18:00",
      reminderMinutesBefore: 30,
      approvalDeadline: "12:00",
      timezone: "Asia/Shanghai" as const
    };

    await new ReminderJobs(new ReminderService(repository), repository, settings)
      .runSubmissionReminderJob(new Date("2026-10-10T09:30:00.000Z"));
    await new ReminderJobs(new ReminderService(repository), repository, settings)
      .runSubmissionReminderJob(new Date("2026-10-10T09:30:00.000Z"));

    expect(repository.reminders).toHaveLength(1);
  });
});
