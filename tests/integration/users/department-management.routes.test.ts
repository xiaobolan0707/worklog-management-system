import type { FastifyInstance } from "fastify";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../../../src/app.js";
import { loadEnv } from "../../../src/config/env.js";
import { hashPassword } from "../../../src/modules/auth/password.js";
import { InMemoryAdministrationRepository } from "../../support/in-memory-administration-repository.js";
import { InMemoryAuthRepository } from "../../support/in-memory-auth-repository.js";

const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: "postgresql://worklog:secret@localhost:5432/worklog", SESSION_SECRET: "a-secure-session-secret-with-32-characters" });
const password = "Employee-password-42";
let passwordHash: string;
let app: FastifyInstance;
let repository: InMemoryAdministrationRepository;
let ids: Record<string, string>;

beforeAll(async () => { passwordHash = await hashPassword(password); });
beforeEach(async () => {
  const authRepository = new InMemoryAuthRepository();
  repository = new InMemoryAdministrationRepository(authRepository);
  await repository.createDepartment("技术部");
  await repository.createDepartment("内容部");
  ids = {};
  for (const [username, role, departmentId] of [
    ["admin", "ADMIN", null], ["manager", "MANAGEMENT", null],
    ["leader", "LEADER", "department-1"], ["unassigned-leader", "LEADER", null],
    ["employee", "EMPLOYEE", "department-1"], ["other", "EMPLOYEE", "department-2"]
  ] as const) {
    const user = await repository.createUser({ username, role, departmentId, displayName: username, passwordHash, accountStatus: "ACTIVE", mustChangePassword: false });
    ids[username] = user.id;
  }
  app = await buildApp({ env, authRepository, administrationRepository: repository });
});
afterEach(async () => { await app.close(); });

async function headers(username: string) {
  const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
  expect(response.statusCode).toBe(200);
  const cookies = response.headers["set-cookie"];
  const cookie = (Array.isArray(cookies) ? cookies : [String(cookies)]).find((item) => item.startsWith("worklog_session="))!.split(";")[0]!;
  return { cookie, "x-csrf-token": response.json().csrfToken as string };
}

describe("department employee management", () => {
  it("renames a department without changing employee membership, and rejects duplicate or blank names", async () => {
    const admin = await headers("admin");
    const url = "/api/admin/departments/department-1";
    expect((await app.inject({ method: "PATCH", url, headers: admin, payload: { name: "  技术研发部  " } })).statusCode).toBe(200);
    const departments = await app.inject({ method: "GET", url: "/api/departments", headers: admin });
    expect(departments.json().departments).toContainEqual({ id: "department-1", name: "技术研发部" });
    const employees = await app.inject({ method: "GET", url: "/api/departments/department-1/employees", headers: admin });
    expect(employees.json().employees).toEqual([expect.objectContaining({ username: "employee", departmentId: "department-1" })]);
    expect(employees.body).not.toContain("passwordHash");
    expect((await app.inject({ method: "PATCH", url, headers: admin, payload: { name: "内容部" } })).statusCode).toBe(409);
    expect((await app.inject({ method: "PATCH", url, headers: admin, payload: { name: "  " } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: "/api/admin/departments/missing", headers: admin, payload: { name: "新名称" } })).statusCode).toBe(404);
  });

  it("allows only administrators to rename departments and requires CSRF", async () => {
    const url = "/api/admin/departments/department-1";
    for (const username of ["leader", "manager", "employee"]) {
      expect((await app.inject({ method: "PATCH", url, headers: await headers(username), payload: { name: "更名" } })).statusCode).toBe(403);
    }
    const admin = await headers("admin");
    expect((await app.inject({ method: "PATCH", url, headers: { cookie: admin.cookie }, payload: { name: "更名" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/departments" })).statusCode).toBe(401);
  });

  it("limits leaders to their own department even with forged department or employee ids", async () => {
    const leader = await headers("leader");
    const departments = await app.inject({ method: "GET", url: "/api/departments", headers: leader });
    expect(departments.json().departments).toEqual([{ id: "department-1", name: "技术部" }]);
    expect((await app.inject({ method: "GET", url: "/api/departments/department-2/employees", headers: leader })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/departments/department-2/employees", headers: leader, payload: { username: "new.one", displayName: "新员工", initialPassword: password } })).statusCode).toBe(403);
    const payload = { username: "changed", displayName: "修改员工", departmentId: "department-1" };
    expect((await app.inject({ method: "PATCH", url: `/api/departments/department-1/employees/${ids["other"]}`, headers: leader, payload })).statusCode).toBe(404);
    expect((await app.inject({ method: "PATCH", url: `/api/departments/department-1/employees/${ids["employee"]}`, headers: leader, payload: { ...payload, departmentId: "department-2" } })).statusCode).toBe(403);
    expect(repository.users.get(ids["other"]!)?.username).toBe("other");
    const unassigned = await app.inject({ method: "GET", url: "/api/departments", headers: await headers("unassigned-leader") });
    expect(unassigned.json().departments).toEqual([]);
  });

  it("lets leaders create ordinary employees in their own department without granting role management", async () => {
    const leader = await headers("leader");
    const url = "/api/departments/department-1/employees";
    const payload = { username: "new.employee", displayName: "新员工", initialPassword: password };
    const response = await app.inject({ method: "POST", url, headers: leader, payload });
    expect(response.statusCode).toBe(201);
    expect(response.json().user).toMatchObject({ username: "new.employee", role: "EMPLOYEE", departmentId: "department-1", mustChangePassword: true });
    expect(response.body).not.toContain("passwordHash");
    expect((await app.inject({ method: "POST", url, headers: leader, payload })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url, headers: leader, payload: { ...payload, username: "escalated", role: "ADMIN" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url, headers: leader, payload: { ...payload, username: "missing-name", displayName: " " } })).statusCode).toBe(400);
  });

  it("lets management move employees between valid departments and keeps both lists consistent", async () => {
    const manager = await headers("manager");
    const url = `/api/departments/department-1/employees/${ids["employee"]}`;
    const payload = { username: "renamed.employee", displayName: "修改姓名", departmentId: "department-2" };
    const response = await app.inject({ method: "PATCH", url, headers: manager, payload });
    expect(response.statusCode).toBe(200);
    expect(response.json().user).toMatchObject({ id: ids["employee"], username: "renamed.employee", displayName: "修改姓名", departmentId: "department-2" });
    const from = await app.inject({ method: "GET", url: "/api/departments/department-1/employees", headers: manager });
    const to = await app.inject({ method: "GET", url: "/api/departments/department-2/employees", headers: manager });
    expect(from.json().employees).toEqual([]);
    expect(to.json().employees).toHaveLength(2);
    const duplicate = await app.inject({ method: "PATCH", url: `/api/departments/department-2/employees/${ids["employee"]}`, headers: manager, payload: { ...payload, username: "other" } });
    expect(duplicate.statusCode).toBe(409);
  });

  it("rejects invalid memberships, non-employee targets and permission fields without changing data", async () => {
    const manager = await headers("manager");
    const payload = { username: "changed", displayName: "新姓名", departmentId: "missing" };
    const url = `/api/departments/department-1/employees/${ids["employee"]}`;
    expect((await app.inject({ method: "PATCH", url, headers: manager, payload })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url, headers: manager, payload: { ...payload, departmentId: "department-1", role: "ADMIN" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: `/api/departments/department-1/employees/${ids["leader"]}`, headers: manager, payload: { ...payload, departmentId: "department-1" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/departments/missing/employees", headers: manager, payload: { username: "missing", displayName: "员工", initialPassword: password } })).statusCode).toBe(400);
    expect(repository.users.get(ids["employee"]!)?.username).toBe("employee");
  });

  it("assigns an employee's self-selected department directly and does not grant organization access", async () => {
    const employee = await headers("employee");
    const options = await app.inject({ method: "GET", url: "/api/profile/departments", headers: employee });
    expect(options.statusCode).toBe(200);
    expect(options.json().departments).toHaveLength(2);
    const url = "/api/profile/department";
    expect((await app.inject({ method: "PUT", url, headers: employee, payload: { departmentId: "department-2" } })).statusCode).toBe(200);
    const profile = await app.inject({ method: "GET", url: "/api/profile", headers: employee });
    expect(profile.json().user).toMatchObject({ id: ids["employee"], departmentId: "department-2", role: "EMPLOYEE" });
    expect(profile.body).not.toContain("passwordHash");
    const list = await app.inject({ method: "GET", url: "/api/departments/department-2/employees", headers: await headers("manager") });
    expect(list.json().employees).toContainEqual(expect.objectContaining({ id: ids["employee"] }));
    expect((await app.inject({ method: "GET", url: "/api/departments", headers: employee })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url, headers: employee, payload: { departmentId: "missing" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url, headers: employee, payload: { departmentId: "department-1", id: ids["other"] } })).statusCode).toBe(400);
    expect(repository.users.get(ids["other"]!)?.departmentId).toBe("department-2");
    expect((await app.inject({ method: "PUT", url, headers: { cookie: employee.cookie }, payload: { departmentId: "department-1" } })).statusCode).toBe(403);
  });
});
