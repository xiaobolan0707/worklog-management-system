import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../../src/app.js";
import { loadEnv } from "../../../src/config/env.js";
import { hashPassword } from "../../../src/modules/auth/password.js";
import { InMemoryAdministrationRepository } from "../../support/in-memory-administration-repository.js";
import { InMemoryAuthRepository } from "../../support/in-memory-auth-repository.js";

const env = loadEnv({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://worklog:secret@localhost:5432/worklog",
  SESSION_SECRET: "a-secure-session-secret-with-32-characters"
});

async function setup() {
  const auth = new InMemoryAuthRepository();
  auth.addUser({
    id: "admin-1",
    username: "admin",
    displayName: "Admin",
    passwordHash: await hashPassword("Admin-password-42"),
    role: "ADMIN",
    accountStatus: "ACTIVE",
    mustChangePassword: false,
    failedLoginCount: 0,
    lockedUntil: null
  });
  const administration = new InMemoryAdministrationRepository(auth);
  const app = await buildApp({ env, authRepository: auth, administrationRepository: administration });
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "admin", password: "Admin-password-42" }
  });
  const setCookie = String(login.headers["set-cookie"]);
  return {
    app,
    administration,
    cookie: setCookie.split(",").find((value) => value.trim().startsWith("worklog_session="))?.trim().split(";")[0] ?? "",
    csrfToken: login.json<{ csrfToken: string }>().csrfToken
  };
}

describe("safe API errors", () => {
  it("returns requestId for CSRF and oversized or injection-shaped input", async () => {
    const { app, cookie, csrfToken } = await setup();
    const csrf = await app.inject({
      method: "PUT",
      url: "/api/admin/settings",
      headers: { cookie },
      payload: {}
    });
    expect(csrf.statusCode).toBe(403);
    expect(csrf.json()).toMatchObject({ code: "CSRF_INVALID" });
    expect(csrf.json().requestId).toBeTruthy();

    const invalid = await app.inject({
      method: "POST",
      url: "/api/admin/users",
      headers: { cookie, "x-csrf-token": csrfToken },
      payload: {
        username: "'; DROP TABLE users;--",
        displayName: "x".repeat(101),
        initialPassword: "Employee-password-42",
        role: "EMPLOYEE"
      }
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.body).not.toContain("stack");
    expect(invalid.json().requestId).toBeTruthy();
    await app.close();
  });

  it("hides internal exception details", async () => {
    const { app, administration, cookie, csrfToken } = await setup();
    administration.createDepartment = async () => {
      throw new Error("secret database stack detail");
    };
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/departments",
      headers: { cookie, "x-csrf-token": csrfToken },
      payload: { name: "研发部" }
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ code: "INTERNAL_ERROR", message: "服务器内部错误" });
    expect(response.body).not.toContain("secret database");
    expect(response.body).not.toContain("stack");
    await app.close();
  });
});
