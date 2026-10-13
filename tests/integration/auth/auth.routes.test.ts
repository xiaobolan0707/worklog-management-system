import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../../../src/app.js";
import { loadEnv } from "../../../src/config/env.js";
import { hashPassword } from "../../../src/modules/auth/password.js";
import { InMemoryAdministrationRepository } from "../../support/in-memory-administration-repository.js";
import { InMemoryAuthRepository } from "../../support/in-memory-auth-repository.js";

const apps: FastifyInstance[] = [];
let repository: InMemoryAuthRepository;
let administrationRepository: InMemoryAdministrationRepository;

const env = loadEnv({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://worklog:secret@localhost:5432/worklog",
  SESSION_SECRET: "a-secure-session-secret-with-32-characters"
});

beforeEach(async () => {
  repository = new InMemoryAuthRepository();
  repository.addUser({
    id: "employee-1",
    username: "employee",
    displayName: "测试员工",
    passwordHash: await hashPassword("Initial-password-42"),
    role: "EMPLOYEE",
    accountStatus: "ACTIVE",
    mustChangePassword: true,
    failedLoginCount: 0,
    lockedUntil: null
  });
  administrationRepository = new InMemoryAdministrationRepository(repository);
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function createApp() {
  const app = await buildApp({ env, authRepository: repository, administrationRepository });
  apps.push(app);
  return app;
}

function sessionCookie(response: { headers: Record<string, unknown> }) {
  const header = response.headers["set-cookie"];
  const values = Array.isArray(header) ? header : [String(header)];
  return values.find((value) => value.startsWith("worklog_session="))?.split(";")[0] ?? "";
}

async function login(app: FastifyInstance, password = "Initial-password-42") {
  return app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "employee", password }
  });
}

describe("authentication routes", () => {
  it("registers a disabled employee account that awaits administrator activation", async () => {
    const app = await createApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        displayName: "新员工",
        username: "new.employee",
        password: "Employee-password-84",
        confirmPassword: "Employee-password-84"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(await administrationRepository.findUserByUsername("new.employee")).toMatchObject({
      displayName: "新员工",
      role: "EMPLOYEE",
      accountStatus: "DISABLED",
      mustChangePassword: false
    });
    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "new.employee", password: "Employee-password-84" }
    });
    expect(loginResponse.statusCode).toBe(403);
    expect(loginResponse.json().code).toBe("ACCOUNT_DISABLED");
  });

  it("rejects duplicate usernames and mismatched registration passwords", async () => {
    const app = await createApp();
    const payload = {
      displayName: "新员工",
      username: "employee",
      password: "Employee-password-84",
      confirmPassword: "Different-password-84"
    };

    const mismatch = await app.inject({ method: "POST", url: "/api/auth/register", payload });
    expect(mismatch.statusCode).toBe(400);

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { ...payload, confirmPassword: payload.password }
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe("USERNAME_EXISTS");
  });

  it("rejects a wrong password and records the failed attempt", async () => {
    const app = await createApp();

    const response = await login(app, "incorrect-password");

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "INVALID_CREDENTIALS", message: "用户名或密码错误" });
    expect(response.json().requestId).toBeTruthy();
    expect(repository.users.get("employee-1")?.failedLoginCount).toBe(1);
    expect(repository.loginAttempts.at(-1)?.outcome).toBe("FAILURE");
  });

  it("rejects a disabled account", async () => {
    const app = await createApp();
    const user = repository.users.get("employee-1");
    if (user) user.accountStatus = "DISABLED";

    const response = await login(app);

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe("ACCOUNT_DISABLED");
  });

  it("requires CSRF and completes the first-login password change", async () => {
    const app = await createApp();
    const loginResponse = await login(app);
    const cookie = sessionCookie(loginResponse);
    const { csrfToken } = loginResponse.json<{ csrfToken: string }>();

    expect(loginResponse.statusCode).toBe(200);
    expect(String(loginResponse.headers["set-cookie"])).toContain("HttpOnly");
    expect(String(loginResponse.headers["set-cookie"])).toContain("SameSite=Lax");

    const rejected = await app.inject({
      method: "POST",
      url: "/api/auth/change-initial-password",
      headers: { cookie },
      payload: { currentPassword: "Initial-password-42", newPassword: "New-password-84" }
    });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json().code).toBe("CSRF_INVALID");

    const changed = await app.inject({
      method: "POST",
      url: "/api/auth/change-initial-password",
      headers: { cookie, "x-csrf-token": csrfToken },
      payload: { currentPassword: "Initial-password-42", newPassword: "New-password-84" }
    });
    expect(changed.statusCode).toBe(200);

    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(me.json().user.mustChangePassword).toBe(false);
  });

  it("rejects an expired server-side session", async () => {
    const app = await createApp();
    const loginResponse = await login(app);
    const cookie = sessionCookie(loginResponse);
    repository.expireAllSessions();

    const response = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("SESSION_EXPIRED");
  });

  it("revokes the current session on logout", async () => {
    const app = await createApp();
    const loginResponse = await login(app);
    const cookie = sessionCookie(loginResponse);
    const { csrfToken } = loginResponse.json<{ csrfToken: string }>();

    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie, "x-csrf-token": csrfToken }
    });
    expect(logout.statusCode).toBe(204);

    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });

  it("temporarily locks the account after five failed passwords", async () => {
    const app = await createApp();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await login(app, "incorrect-password");
    }

    const response = await login(app);

    expect(response.statusCode).toBe(423);
    expect(response.json().code).toBe("ACCOUNT_LOCKED");
    expect(repository.users.get("employee-1")?.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
  });
});
