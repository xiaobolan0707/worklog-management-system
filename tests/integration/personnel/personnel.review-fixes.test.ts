import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPrismaTestDatabase } from "../../support/prisma-test-database.js";
import { PersonnelService } from "../../../src/modules/personnel/personnel.service.js";
import { PrismaAdministrationRepository } from "../../../src/modules/users/user.service.js";
import { ArchiveService } from "../../../src/modules/archives/archive.service.js";
import { ArchiveStorage } from "../../../src/modules/archives/archive-storage.js";
import { assertAccountAccessible } from "../../../src/modules/auth/account-lifecycle.js";

describe("personnel review regressions", () => {
  let context: Awaited<ReturnType<typeof createPrismaTestDatabase>>;
  beforeAll(async () => {
    context = await createPrismaTestDatabase();
    await context.database.department.create({ data: { id: "review-department", name: "复核部门" } });
    await context.database.user.createMany({ data: [
      { id: "review-manager", username: "review-manager", passwordHash: "hash", role: "MANAGEMENT" },
      { id: "review-admin", username: "review-admin", passwordHash: "hash", role: "ADMIN" },
      { id: "review-hr", username: "review-hr", passwordHash: "hash", role: "HR" }
    ] });
  }, 30_000);
  afterAll(async () => { await context?.close(); });

  it("preserves unrelated audit keys and names while removing exact nested private identifiers", async () => {
    const db = context.database;
    const target = "review-purge-target";
    const now = new Date("2026-11-04T02:00:00Z");
    await db.user.createMany({ data: [
      { id: target, username: "employee", displayName: "同名员工", passwordHash: "hash", role: "EMPLOYEE", employmentStatus: "DEPARTED", recycledAt: now },
      { id: "review-other", username: "review-other", displayName: "同名员工", passwordHash: "hash", role: "EMPLOYEE" }
    ] });
    await db.employeeAttachment.create({ data: { userId: target, category: "RESUME", name: "private.pdf", storageKey: "review-private-key", mimeType: "application/pdf", size: 3 } });
    const unrelated = [
      { id: "review-keep-key", metadata: { employeeId: "review-other", recipientId: "review-other" } },
      { id: "review-keep-name", metadata: { displayName: "同名员工", note: "employee" } },
      { id: "review-keep-id-key", metadata: { [target]: "unrelated-value" } }
    ];
    await db.auditEvent.createMany({ data: [...unrelated,
      { id: "review-drop-user", metadata: { nested: [{ employeeId: target }] } },
      { id: "review-drop-file", metadata: { nested: { privateFile: "review-private-key" } } }
    ].map((entry) => ({ ...entry, actorId: "review-manager", subjectUserId: "review-other", action: "REVIEW_AUDIT", entityType: "User", entityId: "review-other" })) });
    const service = new PersonnelService(db, { remove: vi.fn() }, () => now);
    await service.purge({ id: "review-manager", role: "MANAGEMENT" }, target);
    const retained = await db.auditEvent.findMany({ where: { action: "REVIEW_AUDIT" }, select: { id: true, metadata: true }, orderBy: { id: "asc" } });
    expect(retained).toEqual([...unrelated].sort((a, b) => a.id.localeCompare(b.id)));
    expect((await db.user.findUniqueOrThrow({ where: { id: target } })).archivePurgedAt).toEqual(now);
  });

  it("restores visible history for an account deleted before recycling without enabling login", async () => {
    const db = context.database;
    const target = "review-restore-target";
    let now = new Date("2026-11-04T02:00:00Z");
    await db.user.create({ data: { id: target, username: "review-restore-target", displayName: "待恢复员工", passwordHash: "hash", role: "EMPLOYEE", departmentId: "review-department", createdAt: new Date("2026-01-01") } });
    const log = await db.dailyLog.create({ data: { employeeId: target, workDate: new Date("2026-11-03"), status: "ARCHIVED", items: { create: { position: 1, content: "需要保留并恢复的历史日志" } } } });
    const attachment = await db.employeeAttachment.create({ data: { userId: target, category: "RESUME", name: "保留的简历.pdf", storageKey: "review-restored-file", mimeType: "application/pdf", size: 3 } });
    const service = new PersonnelService(db, { remove: vi.fn() }, () => now);
    await service.update({ id: "review-hr", role: "HR" }, target, { hireDate: "2026-01-01", departureDate: "2026-11-04", employmentStatus: "DEPARTED" });
    await new PrismaAdministrationRepository(db).deleteUser("review-admin", target);
    expect((await db.user.findUniqueOrThrow({ where: { id: target } })).deletedAt).not.toBeNull();
    now = new Date("2027-05-05T02:00:00Z");
    await service.runJobs(now);
    expect((await service.listRecycleBin({ id: "review-manager", role: "MANAGEMENT" })).employees.some((employee) => employee.id === target)).toBe(true);
    await service.restore({ id: "review-manager", role: "MANAGEMENT" }, target);
    const archive = await new ArchiveService(db, new ArchiveStorage("unused-review-storage"), () => now).get({ id: "review-manager", role: "MANAGEMENT" }, target);
    expect(archive.archive).toMatchObject({ displayName: "待恢复员工", canEdit: false, employmentStatus: "DEPARTED" });
    expect(archive.archive.attachments).toContainEqual(expect.objectContaining({ id: attachment.id }));
    expect(await db.dailyLog.findUnique({ where: { id: log.id } })).not.toBeNull();
    const restored = await db.user.findUniqueOrThrow({ where: { id: target } });
    expect(restored).toMatchObject({ deletedAt: null, recycledAt: null, restoredAt: now, accountStatus: "DISABLED", employmentStatus: "DEPARTED" });
    expect(() => assertAccountAccessible(restored, now)).toThrow("账号已停用");
    expect((await service.list({ id: "review-hr", role: "HR" })).employees.some((employee) => employee.id === target)).toBe(true);
  });
});
