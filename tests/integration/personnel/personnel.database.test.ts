import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPrismaTestDatabase } from "../../support/prisma-test-database.js";
import { PersonnelService } from "../../../src/modules/personnel/personnel.service.js";

describe("personnel with production PostgreSQL schema", () => {
  let context: Awaited<ReturnType<typeof createPrismaTestDatabase>>;
  beforeAll(async () => {
    context = await createPrismaTestDatabase();
    const db = context.database;
    await db.department.create({ data: { id: "d1", name: "研发部" } });
    await db.user.createMany({ data: [
      { id: "hr", username: "hr", passwordHash: "hash", role: "HR" },
      { id: "manager", username: "manager", passwordHash: "hash", role: "MANAGEMENT" },
      { id: "employee-a", username: "employee-a", passwordHash: "hash", role: "EMPLOYEE", departmentId: "d1" },
      { id: "employee-b", username: "employee-b", passwordHash: "hash", role: "EMPLOYEE", departmentId: "d1" }
    ] });
    await db.systemSetting.update({ where: { key: "employee-archives.enabled-at" }, data: { value: "2026-01-01T00:00:00Z" } });
  }, 30_000);
  afterAll(async () => { await context?.close(); });

  it("executes real Prisma transactions and distinct atomic allocations", async () => {
    const db = context.database;
    const service = new PersonnelService(db, { remove: vi.fn() });
    const results = await Promise.all([service.allocateNumber({ id: "hr", role: "HR" }, "employee-a"), service.allocateNumber({ id: "hr", role: "HR" }, "employee-b")]);
    expect(results.map((row) => row.employeeNumber).sort()).toEqual([1, 2]);
    await service.allocateNumber({ id: "hr", role: "HR" }, "employee-a");
    expect((await db.department.findUniqueOrThrow({ where: { id: "d1" } })).nextEmployeeNumber).toBe(2);
    await db.user.create({ data: { id: "employee-c", username: "employee-c", passwordHash: "hash", role: "EMPLOYEE", departmentId: "d1" } });
    const sameEmployee = await Promise.all([service.allocateNumber({ id: "hr", role: "HR" }, "employee-c"), service.allocateNumber({ id: "hr", role: "HR" }, "employee-c")]);
    expect(sameEmployee.map((row) => row.employeeNumber)).toEqual([3, 3]);
    expect((await db.department.findUniqueOrThrow({ where: { id: "d1" } })).nextEmployeeNumber).toBe(3);
  });

  it("retries file failure, removes owned content and keeps other people's logs and anonymous approvals", async () => {
    const db = context.database;
    const now = new Date("2026-11-04T02:00:00Z");
    await db.user.create({ data: { id: "purge-target", username: "departing-private", displayName: "离职私密姓名", passwordHash: "hash", role: "LEADER", employmentStatus: "DEPARTED", recycledAt: now, employeeNumber: 42, numberDepartmentId: "d1", gender: "女", hireDate: now } });
    const own = await db.dailyLog.create({ data: { employeeId: "purge-target", workDate: now, items: { create: { position: 1, content: "离职人自己的日志" } }, versions: { create: { versionNumber: 1, createdById: "purge-target", snapshot: [{ content: "自己的历史" }] } }, approvalSteps: { create: { approverId: "manager", position: 1, status: "APPROVED", comment: "批注", replies: { create: { itemPosition: 1, content: "离职员工回复" } } } }, colorChanges: { create: { changedById: "manager", fromColor: "RED", toColor: "GRAY", reason: "历史调色" } } } });
    const other = await db.dailyLog.create({ data: { employeeId: "employee-b", workDate: now, items: { create: { position: 1, content: "应完整保留的其他员工日志" } }, versions: { create: [
      { versionNumber: 1, createdById: "employee-b", snapshot: [{ content: "其他员工历史" }] },
      { versionNumber: 2, createdById: "employee-b", snapshot: [{ approverId: "purge-target", name: "离职私密姓名" }] }
    ] }, approvalSteps: { create: { approverId: "purge-target", position: 1, status: "APPROVED", comment: "应清除批注", itemComments: [{ comment: "应清除项批注" }], replies: { create: { itemPosition: 1, content: "对离职人批注的回复" } } } }, colorChanges: { create: { changedById: "purge-target", fromColor: "RED", toColor: "GRAY", reason: "应清除调色正文" } } } });
    await db.employeeAttachment.create({ data: { userId: "purge-target", category: "RESUME", name: "秘密简历.pdf", mimeType: "application/pdf", storageKey: "private-key", size: 3 } });
    await db.auditEvent.createMany({ data: [
      { actorId: "purge-target", action: "APPROVED", entityType: "DailyLog", entityId: other.id, metadata: { comment: "私密批注" } },
      { action: "SHADOW_PAYLOAD", entityType: "DailyLog", entityId: other.id, metadata: { name: "离职私密姓名", privateFile: "private-key" } },
      { action: "UNRELATED", entityType: "DailyLog", entityId: other.id, metadata: {} }
    ] });
    await db.reminder.create({ data: { recipientId: "hr", kind: "ARCHIVE_OVERDUE", deduplicationKey: "purge-target:2026-11-04", title: "提醒", body: "离职私密姓名：资料逾期未补齐" } });
    await db.loginAttempt.create({ data: { username: "departing-private", outcome: "FAILURE", ipAddress: "127.0.0.1" } });
    const remove = vi.fn().mockRejectedValueOnce(new Error("private disk failure")).mockResolvedValue(undefined);
    const service = new PersonnelService(db, { remove }, () => now);
    await expect(service.purge({ id: "manager", role: "MANAGEMENT" }, "purge-target")).rejects.toThrow("private disk failure");
    expect((await db.user.findUniqueOrThrow({ where: { id: "purge-target" } })).archivePurgingAt).not.toBeNull();
    expect(await db.dailyLog.count({ where: { id: own.id } })).toBe(1);
    await expect(service.restore({ id: "manager", role: "MANAGEMENT" }, "purge-target")).rejects.toMatchObject({ statusCode: 409 });
    await service.purge({ id: "manager", role: "MANAGEMENT" }, "purge-target");
    expect(remove).toHaveBeenCalledTimes(2);
    expect(await db.dailyLog.count({ where: { id: own.id } })).toBe(0);
    const saved = await db.dailyLog.findUniqueOrThrow({ where: { id: other.id }, include: { items: true, versions: true, approvalSteps: { include: { replies: true } }, colorChanges: true } });
    expect(saved.items[0]?.content).toBe("应完整保留的其他员工日志");
    expect(saved.versions).toHaveLength(2);
    expect(saved.versions.find((version) => version.versionNumber === 2)?.snapshot).toEqual([{ approverId: "[已清除]", name: "[已清除]" }]);
    expect(saved.approvalSteps[0]).toMatchObject({ approverId: "purge-target", status: "APPROVED", comment: null, itemComments: null });
    expect(saved.approvalSteps[0]?.replies[0]?.content).toBe("对离职人批注的回复");
    expect(saved.colorChanges[0]?.reason).toBe("已清除");
    const tombstone = await db.user.findUniqueOrThrow({ where: { id: "purge-target" } });
    expect(tombstone).toMatchObject({ displayName: "已清除员工", gender: null, hireDate: null, employeeNumber: null, accountStatus: "DISABLED", archivePurgedAt: now });
    expect(await db.loginAttempt.count({ where: { username: "departing-private" } })).toBe(0);
    expect(await db.employeeAttachment.count({ where: { userId: "purge-target" } })).toBe(0);
    expect(await db.auditEvent.count({ where: { action: "SHADOW_PAYLOAD" } })).toBe(0);
    expect(await db.auditEvent.count({ where: { action: "UNRELATED" } })).toBe(1);
    expect(await db.reminder.count({ where: { deduplicationKey: { contains: "purge-target" } } })).toBe(0);
  });

  it("uses exact day-30 and calendar-month boundaries and retains a full 30 days after late recycling", async () => {
    const db = context.database;
    const t0 = new Date("2026-08-31T15:25:30.123Z");
    await db.user.create({ data: { id: "boundary", username: "boundary", passwordHash: "hash", role: "EMPLOYEE", employmentStatus: "DEPARTED", departureMarkedAt: t0, recycleAt: new Date("2027-02-28T15:25:30.123Z") } });
    await db.session.create({ data: { userId: "boundary", tokenHash: "boundary-session", csrfSecret: "csrf", expiresAt: new Date("2027-08-01") } });
    const service = new PersonnelService(db, { remove: vi.fn() });
    await service.runJobs(new Date(t0.getTime() + 30 * 86_400_000 - 1));
    expect((await db.user.findUniqueOrThrow({ where: { id: "boundary" } })).accountStatus).toBe("ACTIVE");
    await service.runJobs(new Date(t0.getTime() + 30 * 86_400_000));
    expect((await db.user.findUniqueOrThrow({ where: { id: "boundary" } })).accountStatus).toBe("DISABLED");
    expect(await db.session.count({ where: { userId: "boundary" } })).toBe(0);
    await service.runJobs(new Date("2027-02-28T15:25:30.122Z"));
    expect((await db.user.findUniqueOrThrow({ where: { id: "boundary" } })).recycledAt).toBeNull();
    const late = new Date("2027-03-04T00:00:00Z");
    await service.runJobs(late);
    expect(await db.user.findUniqueOrThrow({ where: { id: "boundary" } })).toMatchObject({ recycledAt: late, purgeAt: new Date(late.getTime() + 30 * 86_400_000) });
    const restoredService = new PersonnelService(db, { remove: vi.fn() }, () => late);
    await restoredService.restore({ id: "manager", role: "MANAGEMENT" }, "boundary");
    await service.runJobs(new Date("2028-01-01"));
    expect(await db.user.findUniqueOrThrow({ where: { id: "boundary" } })).toMatchObject({ recycledAt: null, archivePurgedAt: null, accountStatus: "DISABLED", restoredAt: late });
  });

  it("deduplicates generic archive reminders after Beijing 9am and stops once complete", async () => {
    const db = context.database;
    await db.user.createMany({ data: [
      { id: "archive-incomplete", username: "archive-incomplete", displayName: "待补齐员工", passwordHash: "hash", role: "EMPLOYEE", departmentId: "d1", createdAt: new Date("2026-02-01") },
      { id: "same-leader", username: "same-leader", passwordHash: "hash", role: "LEADER", departmentId: "d1" }
    ] });
    const service = new PersonnelService(db, { remove: vi.fn() });
    await service.runJobs(new Date("2026-02-08T00:59:59Z"));
    expect(await db.reminder.count({ where: { deduplicationKey: "archive-incomplete:2026-02-08" } })).toBe(0);
    await service.runJobs(new Date("2026-02-08T01:00:00Z"));
    await service.runJobs(new Date("2026-02-08T01:30:00Z"));
    const reminders = await db.reminder.findMany({ where: { deduplicationKey: "archive-incomplete:2026-02-08" } });
    expect(reminders.map((row) => row.recipientId).sort()).toEqual(["archive-incomplete", "hr", "same-leader"]);
    expect(reminders.every((row) => !/RESUME|学历|简历|AGREEMENT|pdf|缺失类别/.test(row.body))).toBe(true);
    await db.user.update({ where: { id: "archive-incomplete" }, data: { gender: "男", hireDate: new Date("2026-01-01"), employeeNumber: 99, numberDepartmentId: "d1" } });
    await db.employeeAttachment.createMany({ data: (["RESUME", "DEGREE", "AGREEMENT"] as const).map((category) => ({ userId: "archive-incomplete", category, name: `${category}.pdf`, storageKey: `complete-${category}`, mimeType: "application/pdf", size: 3 })) });
    await service.runJobs(new Date("2026-02-09T01:00:00Z"));
    expect(await db.reminder.count({ where: { deduplicationKey: "archive-incomplete:2026-02-09" } })).toBe(0);
  });

  it("hands over pending and future obligations atomically while keeping historical decisions", async () => {
    const db = context.database;
    await db.user.createMany({ data: [
      { id: "handover-leader", username: "handover-leader", passwordHash: "hash", role: "LEADER" },
      { id: "handover-later", username: "handover-later", passwordHash: "hash", role: "LEADER" }
    ] });
    await db.employeeApprover.createMany({ data: [
      { employeeId: "employee-a", approverId: "handover-leader", position: 1 },
      { employeeId: "employee-a", approverId: "manager", position: 2 },
      { employeeId: "employee-a", approverId: "handover-later", position: 3 }
    ] });
    const log = await db.dailyLog.create({ data: { employeeId: "employee-a", workDate: new Date("2026-10-15"), status: "SUBMITTED", approvalSteps: { create: [
      { approverId: "handover-leader", submissionNumber: 1, position: 1, status: "APPROVED", comment: "历史已审批，保持不动" },
      { approverId: "handover-leader", submissionNumber: 2, position: 1, status: "PENDING" },
      { approverId: "manager", submissionNumber: 2, position: 2, status: "PENDING" }
    ] } } });
    let now = new Date("2026-11-04T02:00:00Z");
    const service = new PersonnelService(db, { remove: vi.fn() }, () => now);
    const input = { hireDate: "2026-01-01", departureDate: "2026-11-01", employmentStatus: "DEPARTED" as const };
    await expect(service.update({ id: "hr", role: "HR" }, "handover-leader", input)).rejects.toMatchObject({ code: "HANDOVER_REQUIRED" });
    expect((await db.user.findUniqueOrThrow({ where: { id: "handover-leader" } })).employmentStatus).toBe("ACTIVE");
    await service.update({ id: "hr", role: "HR" }, "handover-leader", { ...input, handoverManagerId: "manager" });
    const steps = await db.approvalStep.findMany({ where: { dailyLogId: log.id }, orderBy: [{ submissionNumber: "asc" }, { position: "asc" }] });
    expect(steps.map((step) => [step.approverId, step.status, step.position])).toEqual([["handover-leader", "APPROVED", 1], ["manager", "PENDING", 1], ["manager", "PENDING", 2]]);
    const assignments = await db.employeeApprover.findMany({ where: { employeeId: "employee-a" }, orderBy: { position: "asc" } });
    expect(assignments.map((entry) => [entry.approverId, entry.position])).toEqual([["manager", 1], ["handover-later", 2]]);
    expect((await db.auditEvent.findFirstOrThrow({ where: { action: "APPROVAL_HANDOVER", subjectUserId: "handover-leader" } })).metadata).toMatchObject({ managerId: "manager" });
    now = new Date("2026-11-05T02:00:00Z");
    await service.update({ id: "hr", role: "HR" }, "handover-leader", input);
    expect((await db.user.findUniqueOrThrow({ where: { id: "handover-leader" } })).departureMarkedAt).toEqual(new Date("2026-11-04T02:00:00Z"));
  });

  it("allows one winner between restoring and purging, including a paused file deletion", async () => {
    const db = context.database;
    const now = new Date("2026-11-04T02:00:00Z");
    await db.user.createMany({ data: ["purge-wins", "restore-wins"].map((id) => ({ id, username: id, passwordHash: "hash", role: "EMPLOYEE" as const, employmentStatus: "DEPARTED" as const, recycledAt: now })) });
    await db.employeeAttachment.create({ data: { userId: "purge-wins", category: "RESUME", name: "x.pdf", mimeType: "application/pdf", size: 3, storageKey: "race-file" } });
    let entered!: () => void;
    let finish!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const service = new PersonnelService(db, { remove: async () => { entered(); await gate; } }, () => now);
    const purging = service.purge({ id: "manager", role: "MANAGEMENT" }, "purge-wins");
    await started;
    await expect(service.restore({ id: "manager", role: "MANAGEMENT" }, "purge-wins")).rejects.toMatchObject({ code: "RECYCLE_CONFLICT" });
    finish();
    await purging;
    await service.restore({ id: "manager", role: "MANAGEMENT" }, "restore-wins");
    await expect(service.purge({ id: "manager", role: "MANAGEMENT" }, "restore-wins")).rejects.toMatchObject({ code: "RECYCLE_CONFLICT" });
    expect((await db.user.findUniqueOrThrow({ where: { id: "restore-wins" } })).archivePurgedAt).toBeNull();
  });

  it("redacts exact identity metadata while preserving other employees' snapshot images, body and authored versions", async () => {
    const db = context.database;
    const now = new Date("2026-11-04T02:00:00Z");
    await db.user.create({ data: { id: "identity-data", username: "data", displayName: "员工", passwordHash: "hash", role: "LEADER", employmentStatus: "DEPARTED", recycledAt: now } });
    const snapshot = [{
      position: 1, content: "data processing，员工任务", unfinishedReason: "data",
      images: [{ dataUrl: "data:image/png;base64,YWJj", name: "database.png" }],
      author: { id: "identity-data", username: "data", displayName: "员工" },
      otherUser: { username: "database", displayName: "员工乙" }
    }];
    const log = await db.dailyLog.create({ data: { employeeId: "employee-c", workDate: now, versions: { create: { versionNumber: 1, createdById: "identity-data", snapshot } } } });
    const service = new PersonnelService(db, { remove: vi.fn() }, () => now);
    await service.purge({ id: "manager", role: "MANAGEMENT" }, "identity-data");
    const versions = await db.logVersion.findMany({ where: { dailyLogId: log.id } });
    expect(versions).toHaveLength(1);
    expect(versions[0]?.snapshot).toEqual([{ ...snapshot[0], author: { id: "[已清除]", username: "[已清除]", displayName: "[已清除]" } }]);
  });

  it("retries pending file deletions and excludes pending attachments from archive completeness", async () => {
    const db = context.database;
    const now = new Date("2026-11-04T02:00:00Z");
    await db.user.create({ data: { id: "pending-delete-user", username: "pending-delete-user", displayName: "待重试员工", gender: "男", passwordHash: "hash", role: "EMPLOYEE", departmentId: "d1", employeeNumber: 101, numberDepartmentId: "d1", hireDate: new Date("2026-01-01"), createdAt: new Date("2026-01-01") } });
    await db.employeeAttachment.createMany({ data: (["RESUME", "DEGREE", "AGREEMENT"] as const).map((category) => ({ id: `pending-${category}`, userId: "pending-delete-user", category, name: `${category}.pdf`, storageKey: `pending-key-${category}`, mimeType: "application/pdf", size: 3, deletedAt: category === "RESUME" ? now : null })) });
    const remove = vi.fn().mockRejectedValueOnce(new Error("disk unavailable")).mockResolvedValue(undefined);
    const service = new PersonnelService(db, { remove });
    const dryRun = await service.runJobs(now, true);
    expect(dryRun.pendingAttachmentDeletes).toContain("pending-RESUME");
    expect(remove).not.toHaveBeenCalled();
    const failed = await service.runJobs(now);
    expect(failed.errors).toContainEqual({ id: "pending-RESUME", message: "disk unavailable" });
    expect(await db.employeeAttachment.count({ where: { id: "pending-RESUME" } })).toBe(1);
    expect(await db.reminder.count({ where: { recipientId: "hr", deduplicationKey: "pending-delete-user:2026-11-04" } })).toBe(1);
    const retried = await service.runJobs(now);
    expect(retried.errors).toEqual([]);
    expect(await db.employeeAttachment.count({ where: { id: "pending-RESUME" } })).toBe(0);
    expect(await db.employeeAttachment.count({ where: { userId: "pending-delete-user" } })).toBe(2);
  });
});
