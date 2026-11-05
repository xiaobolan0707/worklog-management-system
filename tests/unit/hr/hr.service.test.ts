import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../../src/generated/prisma/client.js";
import { HrService, hrStatusCsv } from "../../../src/modules/hr/hr.service.js";
import type { AdministrationRepository } from "../../../src/modules/users/user.service.js";
import type { ReminderService } from "../../../src/modules/reminders/reminder.service.js";

const employee = { id: "employee", displayName: "张三", departmentId: "department", department: { name: "技术部" }, createdAt: new Date("2026-01-01"), hireDate: new Date("2026-11-01"), departureDate: null, employmentStatus: "ACTIVE" };
const settings = { submissionDeadline: "18:00", reminderMinutesBefore: 30, approvalDeadline: "12:00", timezone: "Asia/Shanghai", logReminderExcludedWeekdays: [], logReminderExcludedDates: [] };
function setup(users: object[] = [employee], logs: object[] = [], override = {}) {
  const database = { user: { findMany: vi.fn().mockResolvedValue(users), findFirst: vi.fn().mockResolvedValue({ id: "employee" }) }, dailyLog: { findMany: vi.fn().mockResolvedValue(logs) }, department: { findMany: vi.fn().mockResolvedValue([{ id: "department", name: "技术部" }]) }, systemSetting: { findUnique: vi.fn().mockResolvedValue({ value: "2026-11-01T00:00:00.000Z" }) }, $transaction: vi.fn() };
  const repository = { getSettings: vi.fn().mockResolvedValue({ ...settings, ...override }), appendAudit: vi.fn() };
  const reminders = { create: vi.fn().mockResolvedValue({ id: "reminder" }) };
  const service = new HrService(database as unknown as PrismaClient, repository as unknown as AdministrationRepository, reminders as unknown as ReminderService, () => new Date("2026-11-04T11:00:00Z"));
  return { database, repository, reminders, service };
}
function log(workDate: string, status: string, steps: object[] = []) {
  return { id: workDate, employeeId: "employee", workDate: new Date(workDate), status, submissionCount: 2, submittedAt: new Date("2026-10-31T11:00:00Z"), approvalSteps: steps };
}
function step(status: string, submissionNumber = 2, position = 1) {
  return { status, submissionNumber, position, approverId: `leader-${position}`, approver: { displayName: `领导${position}` } };
}

describe("HR metadata supervision", () => {
  it("counts only effective workdays and no future or departed-day obligations", async () => {
    const { service } = setup([{ ...employee, hireDate: new Date("2026-11-02"), departureDate: new Date("2026-11-04") }], [], { logReminderExcludedDates: ["2026-11-03"] });
    const result = await service.status({ from: "2026-11-01", to: "2026-11-06" });
    expect(result.rows.map((row) => row.workDate)).toEqual(["2026-11-02"]);
    expect(result.summary).toMatchObject({ expected: 1, submitted: 0, overduePeople: 1, submissionRate: 0, approvalCompletionRate: null });
  });

  it("starts old employees at activation or registration and handles Beijing date boundaries", async () => {
    const { service } = setup([{ ...employee, hireDate: null, createdAt: new Date("2026-11-02T17:00:00Z") }]);
    const result = await service.status({ from: "2026-11-01", to: "2026-11-04" });
    expect(result.rows.map((row) => row.workDate)).toEqual(["2026-11-03", "2026-11-04"]);
  });

  it("treats drafts as missing, returned as submitted, and requires every current approval to finish", async () => {
    const { service, database } = setup(undefined, [log("2026-11-01", "DRAFT"), log("2026-11-02", "RETURNED", [step("RETURNED")]), log("2026-11-03", "ARCHIVED", [step("APPROVED", 1), step("APPROVED"), step("PENDING", 2, 2)]), log("2026-11-04", "ARCHIVED", [step("RETURNED", 1), step("APPROVED")])]);
    const result = await service.status({ from: "2026-11-01", to: "2026-11-04" });
    expect(result.summary).toMatchObject({ expected: 4, submitted: 3, finalApproved: 1, submissionRate: 0.75, approvalCompletionRate: 1 / 3 });
    expect(result.rows[1]?.approvalStatus).toBe("RETURNED");
    const selections = JSON.stringify([database.user.findMany.mock.calls, database.dailyLog.findMany.mock.calls]);
    for (const forbidden of ["items", "planTarget", "comment", "gender", "archiveAttachments", "passwordHash"]) expect(selections).not.toContain(`"${forbidden}"`);
    expect(Object.keys(result.rows[0]!).sort()).toEqual(["employeeId", "displayName", "departmentId", "departmentName", "workDate", "logId", "expected", "submissionStatus", "approvalStatus", "currentApproverId", "currentApproverName", "approvalOverdue"].sort());
  });

  it("retains voluntary exempt-day approvals without inflating submission rate", async () => {
    const { service } = setup(undefined, [log("2026-11-02", "SUBMITTED", [step("PENDING")])], { logReminderExcludedDates: ["2026-11-02"] });
    const result = await service.status({ from: "2026-11-02", to: "2026-11-02" });
    expect(result.rows[0]).toMatchObject({ expected: false, approvalOverdue: true });
    expect(result.summary).toMatchObject({ expected: 0, submitted: 0, submissionRate: null, approvalCompletionRate: 0 });
  });

  it("revalidates manual reminder eligibility and audits only identifiers and time", async () => {
    const { service, reminders, repository } = setup(undefined, [log("2026-11-02", "SUBMITTED", [step("PENDING"), step("PENDING", 2, 2)])]);
    await service.remind("hr", { employeeId: "employee", workDate: "2026-11-02", kind: "APPROVAL" });
    expect(reminders.create).toHaveBeenCalledWith(expect.objectContaining({ recipientId: "leader-1", deduplicationKey: "hr:APPROVAL:employee:2026-11-02:2026-11-04" }));
    expect(repository.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ actorId: "hr", subjectUserId: "leader-1", metadata: { employeeId: "employee", workDate: "2026-11-02", kind: "APPROVAL", recipientId: "leader-1", at: "2026-11-04T11:00:00.000Z" } }));
    await expect(service.remind("hr", { employeeId: "employee", workDate: "2026-11-02", kind: "SUBMISSION" })).rejects.toMatchObject({ code: "REMINDER_NOT_APPLICABLE" });
  });

  it("rejects invalid/oversized ranges and disallowed exemption settings", async () => {
    const { service } = setup();
    await expect(service.status({ from: "2025-01-01", to: "2026-11-04" })).rejects.toMatchObject({ code: "INVALID_DATE_RANGE" });
    await expect(service.status({ from: "2026-02-30", to: "2026-11-04" })).rejects.toBeDefined();
    await expect(service.updateExemptions("hr", { weekdays: [], dates: [], submissionDeadline: "00:00" })).rejects.toBeDefined();
  });

  it("counts fixed weekday exemptions and displays missing before today's deadline", async () => {
    const { service } = setup(undefined, [], { submissionDeadline: "20:00", logReminderExcludedWeekdays: [1, 2] });
    const result = await service.status({});
    expect(result.from).toBe("2026-11-02");
    expect(result.rows).toEqual([expect.objectContaining({ workDate: "2026-11-04", submissionStatus: "MISSING" })]);
    expect(result.summary.overduePeople).toBe(0);
  });

  it("allows submission nudges only while the employee can still submit", async () => {
    const { service, database, reminders } = setup();
    await service.remind("hr", { employeeId: "employee", workDate: "2026-11-02", kind: "SUBMISSION" });
    expect(reminders.create).toHaveBeenCalledWith(expect.objectContaining({ recipientId: "employee", relatedLogId: null }));
    database.user.findFirst.mockResolvedValue(null);
    await expect(service.remind("hr", { employeeId: "employee", workDate: "2026-11-02", kind: "SUBMISSION" })).rejects.toMatchObject({ code: "REMINDER_NOT_APPLICABLE" });
  });

  it("restarts the 72-hour approval clock on resubmission, including the exact boundary", async () => {
    const recent = { ...log("2026-11-02", "IN_REVIEW", [step("PENDING", 1), step("APPROVED"), step("PENDING", 2, 2)]), submittedAt: new Date("2026-11-01T11:00:00.001Z") };
    const { service, database } = setup(undefined, [recent]);
    const before = await service.status({ from: "2026-11-02", to: "2026-11-02" });
    expect(before.rows[0]).toMatchObject({ currentApproverId: "leader-2", approvalOverdue: false });
    database.dailyLog.findMany.mockResolvedValue([{ ...recent, submittedAt: new Date("2026-11-01T11:00:00Z") }]);
    const after = await service.status({ from: "2026-11-02", to: "2026-11-02" });
    expect(after.rows[0]?.approvalOverdue).toBe(true);
  });

  it("escapes CSV formulas, quotes and line breaks in the same status dataset", async () => {
    const { service } = setup([{ ...employee, displayName: '=HYPERLINK("x")\n张三' }]);
    const csv = hrStatusCsv(await service.status({ from: "2026-11-02", to: "2026-11-02" }));
    expect(csv).toContain('"\'=HYPERLINK(""x"")\n张三"');
    expect(csv).not.toContain("undefined");
  });
});
