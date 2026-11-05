import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../../../src/app.js";
import { loadEnv } from "../../../src/config/env.js";
import { ArchiveService } from "../../../src/modules/archives/archive.service.js";
import { ArchiveStorage } from "../../../src/modules/archives/archive-storage.js";
import { PrismaApprovalRepository } from "../../../src/modules/approvals/approval.service.js";
import { hashPassword } from "../../../src/modules/auth/password.js";
import { PrismaLogRepository } from "../../../src/modules/logs/log.repository.js";
import { createPrismaTestDatabase } from "../../support/prisma-test-database.js";

let context: Awaited<ReturnType<typeof createPrismaTestDatabase>>;
let app: FastifyInstance;
let storage: ArchiveStorage;
let folder: string;
let passwordHash: string;
const now = new Date("2026-11-04T10:00:00Z");
const password = "Archive-regression-42";

beforeAll(async () => { passwordHash = await hashPassword(password); });
beforeEach(async () => {
  context = await createPrismaTestDatabase();
  folder = await mkdtemp(join(tmpdir(), "worklog-archive-regression-"));
  storage = new ArchiveStorage(folder);
  await context.database.department.create({ data: { id: "department", name: "技术部" } });
  for (const [id, role] of [["employee", "EMPLOYEE"], ["leader", "LEADER"], ["manager", "MANAGEMENT"], ["admin", "ADMIN"], ["hr", "HR"]] as const) {
    await context.database.user.create({ data: { id, username: id, displayName: `${id}姓名`, role, departmentId: "department", passwordHash, mustChangePassword: false, hireDate: new Date("2026-11-01") } });
  }
  app = await buildApp({ database: context.database, archiveStorage: storage, now: () => now, env: loadEnv({ NODE_ENV: "test", DATABASE_URL: "postgresql://isolated/unused", SESSION_SECRET: "isolated-archive-regressions-32-character-secret" }) });
});
afterEach(async () => {
  await app?.close();
  await context?.close();
  if (folder && resolve(folder).startsWith(resolve(tmpdir(), "worklog-archive-regression-"))) await rm(folder, { recursive: true, force: true });
});

async function login(username: string) {
  const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
  expect(response.statusCode, response.body).toBe(200);
  const cookies = response.headers["set-cookie"];
  const cookie = (Array.isArray(cookies) ? cookies : [String(cookies)]).find((value) => value.startsWith("worklog_session="))!.split(";")[0]!;
  return { cookie, "x-csrf-token": response.json().csrfToken as string };
}

async function depart(id: string, handoverManagerId?: string) {
  const response = await app.inject({ method: "PATCH", url: `/api/hr/personnel/${id}`, headers: await login("hr"), payload: {
    hireDate: "2026-11-01", departureDate: "2026-11-04", employmentStatus: "DEPARTED", ...(handoverManagerId ? { handoverManagerId } : {})
  } });
  expect(response.statusCode, response.body).toBe(200);
}

function largePdf() {
  const stream = Buffer.alloc(8 * 1024 * 1024, 32);
  const parts = [Buffer.from("%PDF-1.7\n")];
  const objects = [
    Buffer.from("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"),
    Buffer.from("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"),
    Buffer.from("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources <<>> /Contents 4 0 R >>\nendobj\n"),
    Buffer.concat([Buffer.from(`4 0 obj\n<< /Length ${stream.length} >>\nstream\n`), stream, Buffer.from("\nendstream\nendobj\n")])
  ];
  const offsets: number[] = [];
  let offset = parts[0]!.length;
  for (const object of objects) { offsets.push(offset); parts.push(object); offset += object.length; }
  parts.push(Buffer.from(`xref\n0 5\n0000000000 65535 f \n${offsets.map((value) => `${String(value).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`));
  return Buffer.concat(parts);
}

describe("archive and lifecycle regression boundaries with real Prisma", () => {
  it("uploads and downloads an 8 MiB PDF without overflowing Base64 validation", async () => {
    const employee = await login("employee");
    const content = largePdf();
    expect(content.length).toBeGreaterThan(8 * 1024 * 1024);
    expect(content.length).toBeLessThan(10 * 1024 * 1024);
    const uploaded = await app.inject({ method: "POST", url: "/api/archives/employee/attachments", headers: employee, payload: { category: "RESUME", name: "large-resume.pdf", data: content.toString("base64") } });
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const file = uploaded.json().archive.attachments[0];
    expect(file.size).toBe(content.length);
    const downloaded = await app.inject({ url: `/api/archives/employee/attachments/${file.id}`, headers: employee });
    expect(downloaded.statusCode).toBe(200);
    expect(downloaded.rawPayload.equals(content)).toBe(true);
  }, 20_000);

  it("does not reveal or mark a forbidden HR notification through its read endpoint", async () => {
    const reminder = await context.database.reminder.create({ data: { recipientId: "hr", kind: "COMMENT_REPLY", deduplicationKey: "private-notification", title: "旧批注提醒", body: "SECRET_OLD_COMMENT_BODY" } });
    const hr = await login("hr");
    const list = await app.inject({ url: "/api/reminders", headers: hr });
    expect(list.json().reminders).toEqual([]);
    const read = await app.inject({ method: "POST", url: `/api/reminders/${reminder.id}/read`, headers: hr });
    expect(read.statusCode, read.body).toBe(404);
    expect(read.body).not.toContain("SECRET_OLD_COMMENT_BODY");
    expect((await context.database.reminder.findUniqueOrThrow({ where: { id: reminder.id } })).readAt).toBeNull();
  });

  it("rejects assigning a departed leader while their login account is still active", async () => {
    await depart("leader");
    expect((await context.database.user.findUniqueOrThrow({ where: { id: "leader" } })).accountStatus).toBe("ACTIVE");
    const response = await app.inject({ method: "PUT", url: "/api/admin/users/employee/approvers", headers: await login("admin"), payload: { approverIds: ["leader"] } });
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json().code).toBe("INVALID_APPROVER");
    expect(await context.database.employeeApprover.count({ where: { employeeId: "employee" } })).toBe(0);
  });

  it("rejects a draft write already authenticated before departure at the repository boundary", async () => {
    await login("employee");
    await depart("employee");
    const repository = new PrismaLogRepository(context.database);
    await expect(repository.saveDraft("employee", { workDate: "2026-11-04", items: [{ content: "这段工作日志内容超过二十字，验证离职后已经通过认证的旧请求仍然不能写入。", completed: true, images: [] }] })).rejects.toMatchObject({ statusCode: 403, code: "DEPARTED_READ_ONLY" });
    expect(await context.database.dailyLog.count({ where: { employeeId: "employee" } })).toBe(0);
  });

  it("rejects an old leader approval request after departure and preserves the management handover", async () => {
    await login("leader");
    const log = await context.database.dailyLog.create({ data: { employeeId: "employee", workDate: new Date("2026-11-03"), status: "SUBMITTED", submissionCount: 1, submittedAt: now, items: { create: { position: 1, content: "员工日志正文" } }, approvalSteps: { create: { approverId: "leader", position: 1, submissionNumber: 1 } } } });
    await depart("leader", "manager");
    await expect(new PrismaApprovalRepository(context.database).approve(log.id, "leader", "RED", [{ itemPosition: 1, comment: "旧请求不应写入的批注" }])).rejects.toMatchObject({ statusCode: 403, code: "APPROVER_UNAVAILABLE" });
    expect(await context.database.approvalStep.findFirst({ where: { dailyLogId: log.id } })).toMatchObject({ approverId: "manager", status: "PENDING", actedAt: null });
    expect((await context.database.dailyLog.findUniqueOrThrow({ where: { id: log.id } })).status).toBe("SUBMITTED");
  });

  it("denies legacy admin mutations of a recycled employee and still restores the archive", async () => {
    await context.database.user.update({ where: { id: "employee" }, data: { employmentStatus: "DEPARTED", departureMarkedAt: now, accountStatus: "DISABLED", recycledAt: now, purgeAt: new Date(now.getTime() + 30 * 86_400_000) } });
    const admin = await login("admin");
    for (const [method, url, payload] of [
      ["DELETE", "/api/admin/users/employee", undefined],
      ["PATCH", "/api/admin/users/employee/status", { accountStatus: "ACTIVE" }],
      ["POST", "/api/admin/users/employee/reset-password", { initialPassword: "forbidden-reset-42" }]
    ] as const) {
      const response = await app.inject({ method, url, headers: admin, ...(payload ? { payload } : {}) });
      expect(response.statusCode, `${method} ${url}: ${response.body}`).toBe(404);
    }
    const stillRecycled = await context.database.user.findUniqueOrThrow({ where: { id: "employee" } });
    expect(stillRecycled).toMatchObject({ deletedAt: null, accountStatus: "DISABLED", passwordHash });
    const manager = await login("manager");
    const restored = await app.inject({ method: "POST", url: "/api/recycle-bin/employee/restore", headers: manager });
    expect(restored.statusCode, restored.body).toBe(200);
    const archive = await app.inject({ url: "/api/archives/employee", headers: manager });
    expect(archive.statusCode, archive.body).toBe(200);
    expect(archive.json().archive.displayName).toBe("employee姓名");
    expect((await context.database.user.findUniqueOrThrow({ where: { id: "employee" } })).accountStatus).toBe("DISABLED");
  });

  it("lets a departed leader read their own old log while denying other employees' logs", async () => {
    const own = await context.database.dailyLog.create({ data: { employeeId: "leader", workDate: new Date("2026-11-02"), status: "ARCHIVED", items: { create: { position: 1, content: "OWN_HISTORICAL_LOG" } } } });
    const other = await context.database.dailyLog.create({ data: { employeeId: "employee", workDate: new Date("2026-11-02"), items: { create: { position: 1, content: "OTHER_PRIVATE_LOG" } } } });
    const leader = await login("leader");
    await depart("leader");
    const ownResponse = await app.inject({ url: `/api/logs/${own.id}`, headers: leader });
    expect(ownResponse.statusCode, ownResponse.body).toBe(200);
    expect(ownResponse.body).toContain("OWN_HISTORICAL_LOG");
    const forbidden = await app.inject({ url: `/api/logs/${other.id}`, headers: leader });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.body).not.toContain("OTHER_PRIVATE_LOG");
  });

  it("keeps attachment bytes and metadata when its deletion audit fails and the transaction rolls back", async () => {
    const content = Buffer.from("%PDF-1.7\nPRIVATE_RESUME\n%%EOF");
    const storageKey = await storage.save(content);
    const file = await context.database.employeeAttachment.create({ data: { userId: "employee", category: "RESUME", name: "resume.pdf", mimeType: "application/pdf", size: content.length, storageKey } });
    await context.database.$executeRawUnsafe("CREATE FUNCTION review_reject_delete_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'review forced audit failure'; END; $$ LANGUAGE plpgsql");
    await context.database.$executeRawUnsafe("CREATE TRIGGER review_reject_delete_audit BEFORE INSERT ON audit_events FOR EACH ROW WHEN (NEW.action = 'ARCHIVE_ATTACHMENT_DELETED') EXECUTE FUNCTION review_reject_delete_audit()");
    const service = new ArchiveService(context.database, storage, () => now);
    await expect(service.remove({ id: "employee", role: "EMPLOYEE", employmentStatus: "ACTIVE" }, "employee", file.id)).rejects.toThrow(/review forced audit failure/);
    expect((await context.database.employeeAttachment.findUniqueOrThrow({ where: { id: file.id } })).deletedAt).toBeNull();
    expect((await storage.read(storageKey)).equals(content)).toBe(true);
    expect(await context.database.auditEvent.count({ where: { action: "ARCHIVE_ATTACHMENT_DELETED" } })).toBe(0);
  });
});
