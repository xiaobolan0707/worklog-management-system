import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../src/app.js";
import { loadEnv } from "../../../src/config/env.js";
import { hashPassword } from "../../../src/modules/auth/password.js";
import { ArchiveStorage } from "../../../src/modules/archives/archive-storage.js";
import { createPrismaTestDatabase } from "../../support/prisma-test-database.js";

let context: Awaited<ReturnType<typeof createPrismaTestDatabase>>;
let app: FastifyInstance;
let folder: string;
let now: Date;
let passwordHash: string;
const password = "Archive-test-42";
beforeAll(async () => { passwordHash = await hashPassword(password); });
beforeEach(async () => {
  context = await createPrismaTestDatabase();
  folder = await mkdtemp(join(tmpdir(), "worklog-archive-test-"));
  now = new Date("2026-11-04T10:00:00Z");
  const db = context.database;
  await db.department.createMany({ data: [{ id: "d1", name: "研发部" }, { id: "d2", name: "内容部" }] });
  for (const [id, role, departmentId] of [["employee", "EMPLOYEE", "d1"], ["other", "EMPLOYEE", "d2"], ["leader", "LEADER", "d1"], ["manager", "MANAGEMENT", "d1"], ["admin", "ADMIN", null], ["hr", "HR", null]] as const) {
    await db.user.create({ data: { id, username: id, displayName: `${id}姓名`, role, departmentId, passwordHash, mustChangePassword: false, hireDate: new Date("2026-11-01"), gender: "FEMALE" } });
  }
  app = await buildApp({ database: db, archiveStorage: new ArchiveStorage(folder), now: () => now, env: loadEnv({ NODE_ENV: "test", DATABASE_URL: "postgresql://isolated/unused", SESSION_SECRET: "isolated-archive-tests-secret-32-characters" }) });
});
afterEach(async () => {
  await app?.close(); await context?.close();
  if (folder && resolve(folder).startsWith(resolve(tmpdir(), "worklog-archive-test-"))) await rm(folder, { recursive: true, force: true });
});
async function login(username: string) {
  const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
  expect(response.statusCode).toBe(200);
  const cookies = response.headers["set-cookie"];
  const cookie = (Array.isArray(cookies) ? cookies : [String(cookies)]).find((value) => value.startsWith("worklog_session="))!.split(";")[0]!;
  return { cookie, "x-csrf-token": response.json().csrfToken as string };
}

describe("employee archives with real Prisma and isolated PostgreSQL", () => {
  it("lets departed staff finish a required credential reset while keeping business data read-only", async () => {
    const hr = await login("hr");
    expect((await app.inject({ method: "PATCH", url: "/api/hr/personnel/employee", headers: hr, payload: { hireDate: "2026-11-01", departureDate: "2026-11-04", employmentStatus: "DEPARTED" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/admin/users/employee/reset-password", headers: await login("admin"), payload: { initialPassword: password } })).statusCode).toBe(200);
    const employee = await login("employee");
    expect((await app.inject({ method: "GET", url: "/api/archives/employee", headers: employee })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/auth/change-initial-password", headers: employee, payload: { currentPassword: password, newPassword: `${password}-changed` } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/archives/employee", headers: employee })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/logs/drafts", headers: employee, payload: {} })).statusCode).toBe(403);
  });
  it("never returns a departed employee's pending log through the old admin disable/delete flow", async () => {
    const db = context.database;
    const hr = await login("hr");
    const admin = await login("admin");
    const log = await db.dailyLog.create({ data: { employeeId: "employee", workDate: new Date("2026-11-03"), status: "SUBMITTED", submissionCount: 1, approvalSteps: { create: { approverId: "leader", position: 1, submissionNumber: 1 } } } });
    expect((await app.inject({ method: "PATCH", url: "/api/hr/personnel/employee", headers: hr, payload: { hireDate: "2026-11-01", departureDate: "2026-11-04", employmentStatus: "DEPARTED" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "PATCH", url: "/api/admin/users/leader/status", headers: admin, payload: { accountStatus: "DISABLED" } })).statusCode).toBe(409);
    expect((await app.inject({ method: "DELETE", url: "/api/admin/users/leader", headers: admin })).statusCode).toBe(409);
    expect(await db.dailyLog.findUnique({ where: { id: log.id } })).toMatchObject({ status: "SUBMITTED" });
    expect((await app.inject({ method: "PATCH", url: "/api/hr/personnel/leader", headers: hr, payload: { hireDate: "2026-11-01", departureDate: "2026-11-04", employmentStatus: "DEPARTED", handoverManagerId: "manager" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "PATCH", url: "/api/admin/users/leader/status", headers: admin, payload: { accountStatus: "DISABLED" } })).statusCode).toBe(200);
    expect(await db.approvalStep.findFirst({ where: { dailyLogId: log.id } })).toMatchObject({ status: "PENDING", approverId: "manager" });
  });
  it("enforces every role boundary and prevents old HR content paths", async () => {
    const hr = await login("hr");
    for (const url of ["/api/logs", "/api/logs/secret", "/api/logs/mine", "/api/approvals/pending", "/api/reports/employees", "/api/audit-events", "/api/archives", "/api/archives/employee", "/api/archives/employee/attachments/forged", "/api/recycle-bin", "/api/profile", "/api/departments"]) {
      expect((await app.inject({ method: "GET", url, headers: hr })).statusCode, url).toBe(403);
    }
    const leader = await login("leader");
    expect((await app.inject({ method: "GET", url: "/api/archives/employee", headers: leader })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/archives/other", headers: leader })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/archives/employee", headers: await login("admin") })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/archives/other", headers: await login("employee") })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/archives/other", headers: await login("manager") })).statusCode).toBe(200);
  });

  it("stores three protected attachment categories and separates employee vs HR writes", async () => {
    const employee = await login("employee");
    const hr = await login("hr");
    expect((await app.inject({ method: "PATCH", url: "/api/archives/employee", headers: employee, payload: { displayName: "张三", gender: "MALE", employeeNumber: 1 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: "/api/archives/employee", headers: employee, payload: { displayName: "张三", gender: "MALE" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/hr/personnel/employee/number", headers: employee })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/hr/personnel/employee/number", headers: hr })).statusCode).toBe(200);
    const content = Buffer.from("%PDF-1.7\nprivate-resume-content\n%%EOF");
    let fileId = "";
    for (const category of ["RESUME", "DEGREE", "AGREEMENT"]) {
      const response = await app.inject({ method: "POST", url: "/api/archives/employee/attachments", headers: employee, payload: { category, name: `${category}.pdf`, data: content.toString("base64") } });
      expect(response.statusCode, response.body).toBe(201);
      fileId = response.json().archive.attachments[0].id;
      expect(response.body).not.toContain("storageKey");
    }
    const archive = await app.inject({ method: "GET", url: "/api/archives/employee", headers: employee });
    expect(archive.json().archive.complete).toBe(true);
    const path = `/api/archives/employee/attachments/${fileId}`;
    expect((await app.inject({ method: "GET", url: path, headers: hr })).statusCode).toBe(403);
    const downloaded = await app.inject({ method: "GET", url: path, headers: await login("leader") });
    expect(downloaded.rawPayload.equals(content)).toBe(true);
    expect(downloaded.headers["content-disposition"]).toContain("attachment;");
    expect((await app.inject({ method: "GET", url: `/api/archives/other/attachments/${fileId}`, headers: await login("manager") })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: path, headers: { cookie: employee.cookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: path, headers: employee })).statusCode).toBe(200);
  });

  it("immediately makes an open session read-only and denies it at day 30", async () => {
    const employee = await login("employee");
    const hr = await login("hr");
    await context.database.session.updateMany({ where: { userId: "employee" }, data: { expiresAt: new Date("2027-02-01") } });
    const response = await app.inject({ method: "PATCH", url: "/api/hr/personnel/employee", headers: hr, payload: { hireDate: "2026-11-01", departureDate: "2026-11-04", employmentStatus: "DEPARTED" } });
    expect(response.statusCode, response.body).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/archives/employee", headers: employee })).statusCode).toBe(200);
    for (const [method, url, payload] of [["PATCH", "/api/archives/employee", { displayName: "changed", gender: "MALE" }], ["PUT", "/api/profile/department", { departmentId: "d2" }], ["POST", "/api/logs/drafts", {}]] as const) {
      expect((await app.inject({ method, url, headers: employee, payload })).statusCode).toBe(403);
    }
    now = new Date(now.getTime() + 30 * 86_400_000);
    expect((await app.inject({ method: "GET", url: "/api/archives/employee", headers: employee })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "employee", password } })).statusCode).toBe(403);
  });

  it("returns only state data to HR, counts exemptions and protects field ownership", async () => {
    const db = context.database;
    await db.dailyLog.create({ data: { employeeId: "employee", workDate: new Date("2026-11-03"), status: "RETURNED", submissionCount: 1, submittedAt: new Date("2026-11-03T01:00:00Z"), planTarget: "SECRET_PLAN", items: { create: { position: 1, content: "SECRET_BODY" } } } });
    const hr = await login("hr");
    let response = await app.inject({ method: "GET", url: "/api/hr/status?from=2026-11-03&to=2026-11-04", headers: hr });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().rows.find((row: { employeeId: string; workDate: string }) => row.employeeId === "employee" && row.workDate === "2026-11-03")).toMatchObject({ submissionStatus: "SUBMITTED", approvalStatus: "RETURNED" });
    for (const text of ["SECRET_BODY", "SECRET_PLAN", "gender", "passwordHash", "attachments", "itemComments"]) expect(response.body).not.toContain(text);
    expect((await app.inject({ method: "PUT", url: "/api/hr/exemptions", headers: hr, payload: { weekdays: [], dates: ["2026-11-04"], submissionDeadline: "01:00" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/api/hr/exemptions", headers: hr, payload: { weekdays: [], dates: ["2026-11-04"] } })).statusCode).toBe(200);
    response = await app.inject({ method: "GET", url: "/api/hr/status?from=2026-11-04&to=2026-11-04", headers: hr });
    expect(response.json().summary.expected).toBe(0);
    expect(response.json().summary.submissionRate).toBeNull();
  });
});
