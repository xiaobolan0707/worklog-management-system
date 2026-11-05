import { describe, expect, it } from "vitest";

import { ReminderJobs } from "../../../src/modules/reminders/reminder.jobs.js";
import { ReminderService } from "../../../src/modules/reminders/reminder.service.js";
import { InMemoryReminderRepository } from "../../support/in-memory-reminder-repository.js";

describe("submission reminder job", () => {
  it("skips warnings and overdue logs on chosen weekdays while retaining approval reminders", async () => {
    const repository = new InMemoryReminderRepository();
    repository.missingEmployeeIds = ["employee-1"];
    repository.overdueApprovalLeaderIds = ["leader-1"];
    const jobs = new ReminderJobs(new ReminderService(repository), repository, async () => ({
      submissionDeadline: "18:00", reminderMinutesBefore: 30,
      approvalDeadline: "12:00", timezone: "Asia/Shanghai",
      logReminderExcludedWeekdays: [0], logReminderExcludedDates: []
    }));
    await jobs.runSubmissionReminderJob(new Date("2026-11-01T09:30:00Z"));
    await jobs.runSubmissionReminderJob(new Date("2026-11-01T10:01:00Z"));
    expect(repository.reminders.map((item) => item.kind)).toEqual(["APPROVAL_OVERDUE"]);
    await jobs.runSubmissionReminderJob(new Date("2026-11-02T09:30:00Z"));
    expect(repository.reminders.some((item) => item.kind === "LOG_DUE" && item.deduplicationKey === "2026-11-02")).toBe(true);
  });

  it("uses the Beijing weekday when UTC is still the previous day", async () => {
    const repository = new InMemoryReminderRepository();
    repository.missingEmployeeIds = ["employee-1"];
    const jobs = new ReminderJobs(new ReminderService(repository), repository, async () => ({
      submissionDeadline: "00:00", reminderMinutesBefore: 0,
      approvalDeadline: "23:59", timezone: "Asia/Shanghai",
      logReminderExcludedWeekdays: [0]
    }));
    await jobs.runSubmissionReminderJob(new Date("2026-10-31T16:05:00Z"));
    expect(repository.reminders).toHaveLength(0);
  });

  it("uses chosen Beijing dates and applies removal without restarting", async () => {
    const repository = new InMemoryReminderRepository();
    repository.missingEmployeeIds = ["employee-1"];
    let excludedDates = ["2026-11-03"];
    const jobs = new ReminderJobs(new ReminderService(repository), repository, async () => ({
      submissionDeadline: "00:00", reminderMinutesBefore: 0,
      approvalDeadline: "23:59", timezone: "Asia/Shanghai",
      logReminderExcludedDates: excludedDates
    }));
    const now = new Date("2026-11-02T16:05:00Z");
    await jobs.runSubmissionReminderJob(now);
    expect(repository.reminders).toHaveLength(0);
    excludedDates = [];
    await jobs.runSubmissionReminderJob(now);
    expect(repository.reminders.map((item) => [item.kind, item.deduplicationKey])).toEqual([["LOG_OVERDUE", "2026-11-03"]]);
  });

  it("creates warning and overdue reminders using Beijing time", async () => {
    const repository = new InMemoryReminderRepository();
    repository.missingEmployeeIds = ["employee-1"];
    repository.overdueApprovalLeaderIds = ["leader-1"];
    const jobs = new ReminderJobs(new ReminderService(repository), repository, async () => ({
      submissionDeadline: "18:00",
      reminderMinutesBefore: 30,
      approvalDeadline: "12:00",
      timezone: "Asia/Shanghai"
    }));

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

    await new ReminderJobs(new ReminderService(repository), repository, async () => settings)
      .runSubmissionReminderJob(new Date("2026-10-10T09:30:00.000Z"));
    await new ReminderJobs(new ReminderService(repository), repository, async () => settings)
      .runSubmissionReminderJob(new Date("2026-10-10T09:30:00.000Z"));

    expect(repository.reminders).toHaveLength(1);
  });

  it("uses schedule changes without restarting the application", async () => {
    const repository = new InMemoryReminderRepository();
    repository.missingEmployeeIds = ["employee-1"];
    let deadline = "18:00";
    const jobs = new ReminderJobs(new ReminderService(repository), repository, async () => ({
      submissionDeadline: deadline, reminderMinutesBefore: 30,
      approvalDeadline: "12:00", timezone: "Asia/Shanghai"
    }));
    await jobs.runSubmissionReminderJob(new Date("2026-10-10T08:30:00.000Z"));
    deadline = "17:00";
    await jobs.runSubmissionReminderJob(new Date("2026-10-10T08:30:00.000Z"));
    expect(repository.reminders.map((item) => item.kind)).toEqual(["LOG_DUE"]);
  });
});
