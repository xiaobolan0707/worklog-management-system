import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../../../src/app.js";
import { loadEnv } from "../../../src/config/env.js";
import { hashPassword, verifyPassword } from "../../../src/modules/auth/password.js";
import { InMemoryAdministrationRepository } from "../../support/in-memory-administration-repository.js";
import { InMemoryAuthRepository } from "../../support/in-memory-auth-repository.js";

const apps: FastifyInstance[] = [];
const env = loadEnv({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://worklog:secret@localhost:5432/worklog",
  SESSION_SECRET: "a-secure-session-secret-with-32-characters"
});
let authRepository: InMemoryAuthRepository;
let administrationRepository: InMemoryAdministrationRepository;

beforeEach(async () => {
  authRepository = new InMemoryAuthRepository();
  authRepository.addUser({
    id: "admin-1",
    username: "admin",
    displayName: "管理员",
    passwordHash: await hashPassword("Admin-password-42"),
    role: "ADMIN",
    accountStatus: "ACTIVE",
    mustChangePassword: false,
    failedLoginCount: 0,
    lockedUntil: null
  });
  authRepository.addUser({
    id: "leader-1",
    username: "leader",
    displayName: "部门领导",
    passwordHash: await hashPassword("Leader-password-42"),
    role: "LEADER",
    accountStatus: "ACTIVE",
    mustChangePassword: false,
    failedLoginCount: 0,
    lockedUntil: null
  });
  administrationRepository = new InMemoryAdministrationRepository(authRepository);
});

afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

async function createApp() {
  const app = await buildApp({ env, authRepository, administrationRepository });
  apps.push(app);
  return app;
}

async function credentials(app: FastifyInstance, username: string, password: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username, password }
  });
  const header = response.headers["set-cookie"];
  const values = Array.isArray(header) ? header : [String(header)];
  return {
    cookie: values.find((value) => value.startsWith("worklog_session="))?.split(";")[0] ?? "",
    csrfToken: response.json<{ csrfToken: string }>().csrfToken
  };
}

describe("administrator organization routes", () => {
  it("does not let the only active administrator disable their own account", async () => {
    const app = await createApp();
    const auth = await credentials(app, "admin", "Admin-password-42");
    const response = await app.inject({
      method: "PATCH",
      url: "/api/admin/users/admin-1/status",
      headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      payload: { accountStatus: "DISABLED" }
    });
    expect(response.statusCode).toBe(400);
    expect(authRepository.users.get("admin-1")?.accountStatus).toBe("ACTIVE");
  });

  it("rejects an employee or disabled leader in an approval chain", async () => {
    const app = await createApp();
    const auth = await credentials(app, "admin", "Admin-password-42");
    const employee = await administrationRepository.createUser({
      username: "employee", displayName: "员工", passwordHash: "hidden", role: "EMPLOYEE",
      accountStatus: "ACTIVE", departmentId: null, mustChangePassword: false
    });
    const disabledLeader = await administrationRepository.createUser({
      username: "disabled", displayName: "停用领导", passwordHash: "hidden", role: "LEADER",
      accountStatus: "DISABLED", departmentId: null, mustChangePassword: false
    });
    for (const approverId of [employee.id, disabledLeader.id]) {
      const response = await app.inject({
        method: "PUT", url: `/api/admin/users/${employee.id}/approvers`,
        headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
        payload: { approverIds: [approverId] }
      });
      expect(response.statusCode).toBe(400);
      expect(administrationRepository.approvers.has(employee.id)).toBe(false);
    }
  });

  it("lists users and departments for usable administration screens", async () => {
    const app = await createApp();
    const auth = await credentials(app, "admin", "Admin-password-42");
    await administrationRepository.createDepartment("研发部");
    await administrationRepository.createUser({
      username: "employee",
      displayName: "张三",
      passwordHash: "hidden",
      role: "EMPLOYEE",
      accountStatus: "ACTIVE",
      departmentId: "department-1",
      mustChangePassword: true
    });

    const users = await app.inject({ method: "GET", url: "/api/admin/users", headers: { cookie: auth.cookie } });
    const departments = await app.inject({ method: "GET", url: "/api/admin/departments", headers: { cookie: auth.cookie } });

    expect(users.statusCode).toBe(200);
    expect(users.json().users).toEqual([expect.objectContaining({ username: "employee", displayName: "张三" })]);
    expect(users.body).not.toContain("passwordHash");
    expect(departments.json().departments).toEqual([{ id: "department-1", name: "研发部" }]);
  });

  it("creates an account with a hashed initial password and rejects duplicate usernames", async () => {
    const app = await createApp();
    const auth = await credentials(app, "admin", "Admin-password-42");
    const request = {
      method: "POST" as const,
      url: "/api/admin/users",
      headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      payload: {
        username: "employee",
        displayName: "张三",
        initialPassword: "Employee-password-42",
        role: "EMPLOYEE"
      }
    };

    const created = await app.inject(request);
    expect(created.statusCode).toBe(201);
    expect(created.json().user).toMatchObject({ username: "employee", mustChangePassword: true });
    expect(created.body).not.toContain("passwordHash");
    const stored = [...administrationRepository.users.values()][0]!;
    await expect(verifyPassword("Employee-password-42", stored.passwordHash)).resolves.toBe(true);

    const duplicate = await app.inject(request);
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe("USERNAME_EXISTS");
  });

  it("accepts six-character initial passwords for every role and rejects shorter ones", async () => {
    const app = await createApp();
    const auth = await credentials(app, "admin", "Admin-password-42");

    for (const role of ["EMPLOYEE", "LEADER", "MANAGEMENT", "ADMIN"] as const) {
      const response = await app.inject({
        method: "POST",
        url: "/api/admin/users",
        headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
        payload: {
          username: `${role.toLowerCase()}2`,
          displayName: role,
          initialPassword: "123456",
          role
        }
      });
      expect(response.statusCode).toBe(201);
    }

    const rejected = await app.inject({
      method: "POST",
      url: "/api/admin/users",
      headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      payload: {
        username: "short-password",
        displayName: "短密码",
        initialPassword: "12345",
        role: "EMPLOYEE"
      }
    });
    expect(rejected.statusCode).toBe(400);
  });

  it("resets passwords at the six-character boundary", async () => {
    const app = await createApp();
    const auth = await credentials(app, "admin", "Admin-password-42");
    const target = await administrationRepository.createUser({
      username: "employee",
      displayName: "张三",
      passwordHash: await hashPassword("Old-password-42"),
      role: "EMPLOYEE",
      accountStatus: "ACTIVE",
      departmentId: null,
      mustChangePassword: false
    });
    const request = (initialPassword: string) => app.inject({
      method: "POST",
      url: `/api/admin/users/${target.id}/reset-password`,
      headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      payload: { initialPassword }
    });

    expect((await request("12345")).statusCode).toBe(400);
    expect((await request("123456")).statusCode).toBe(200);
    await expect(verifyPassword("123456", administrationRepository.users.get(target.id)!.passwordHash)).resolves.toBe(true);
  });

  it("prevents a leader from administering accounts", async () => {
    const app = await createApp();
    const auth = await credentials(app, "leader", "Leader-password-42");

    const response = await app.inject({
      method: "POST",
      url: "/api/admin/users",
      headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      payload: {
        username: "employee",
        displayName: "张三",
        initialPassword: "Employee-password-42",
        role: "EMPLOYEE"
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe("FORBIDDEN");
  });

  it("hides and disables an account with business history as an administrator", async () => {
    const app = await createApp();
    const auth = await credentials(app, "admin", "Admin-password-42");
    const target = await administrationRepository.createUser({
      username: "unused",
      displayName: "待删除用户",
      passwordHash: "hidden",
      role: "EMPLOYEE",
      accountStatus: "ACTIVE",
      departmentId: null,
      mustChangePassword: true
    });
    administrationRepository.protectedUsers.add(target.id);

    const response = await app.inject({
      method: "DELETE",
      url: `/api/admin/users/${target.id}`,
      headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken }
    });

    expect(response.statusCode).toBe(204);
    expect(administrationRepository.users.get(target.id)).toMatchObject({
      accountStatus: "DISABLED",
      username: `deleted-${target.id}`
    });
    const listed = await app.inject({ method: "GET", url: "/api/admin/users", headers: { cookie: auth.cookie } });
    expect(listed.json().users).toEqual([]);
  });

  it("validates worklog deadline and reminder settings", async () => {
    const app = await createApp();
    const auth = await credentials(app, "admin", "Admin-password-42");

    const response = await app.inject({
      method: "PUT",
      url: "/api/admin/settings",
      headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      payload: {
        submissionDeadline: "25:90",
        reminderMinutesBefore: -1,
        approvalDeadline: "12:00",
        timezone: "Asia/Shanghai"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("VALIDATION_ERROR");
  });
});
