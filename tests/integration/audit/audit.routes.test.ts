import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../../src/app.js";
import { loadEnv } from "../../../src/config/env.js";
import { hashPassword } from "../../../src/modules/auth/password.js";
import { InMemoryAdministrationRepository } from "../../support/in-memory-administration-repository.js";
import { InMemoryAuditQueryRepository } from "../../support/in-memory-audit-query-repository.js";
import { InMemoryAuthRepository } from "../../support/in-memory-auth-repository.js";

const env = loadEnv({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://worklog:secret@localhost:5432/worklog",
  SESSION_SECRET: "a-secure-session-secret-with-32-characters"
});

async function setup(role: "ADMIN" | "LEADER" = "ADMIN") {
  const auth = new InMemoryAuthRepository();
  auth.addUser({
    id: "actor-1",
    username: "actor",
    displayName: "Actor",
    passwordHash: await hashPassword("Actor-password-42"),
    role,
    accountStatus: "ACTIVE",
    mustChangePassword: false,
    failedLoginCount: 0,
    lockedUntil: null
  });
  const audit = new InMemoryAuditQueryRepository();
  audit.events.push(
    {
      id: "event-2",
      actorId: "actor-1",
      subjectUserId: "employee-1",
      action: "LOG_APPROVED",
      entityType: "DailyLog",
      entityId: "log-1",
      metadata: {},
      createdAt: new Date("2026-10-10T02:00:00.000Z")
    },
    {
      id: "event-1",
      actorId: "actor-2",
      subjectUserId: "employee-2",
      action: "LOG_SUBMITTED",
      entityType: "DailyLog",
      entityId: "log-2",
      metadata: {},
      createdAt: new Date("2026-10-10T01:00:00.000Z")
    }
  );
  const app = await buildApp({
    env,
    authRepository: auth,
    administrationRepository: new InMemoryAdministrationRepository(auth),
    auditQueryRepository: audit
  });
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "actor", password: "Actor-password-42" }
  });
  const header = login.headers["set-cookie"];
  const values = Array.isArray(header) ? header : [String(header)];
  return {
    app,
    cookie: values.find((value) => value.startsWith("worklog_session="))?.split(";")[0] ?? ""
  };
}

describe("audit search", () => {
  it("filters, paginates, and keeps newest-first stable order", async () => {
    const { app, cookie } = await setup();
    const response = await app.inject({
      method: "GET",
      url: "/api/audit-events?action=LOG_APPROVED&page=1&pageSize=1",
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [{ id: "event-2", action: "LOG_APPROVED" }],
      total: 1,
      page: 1,
      pageSize: 1
    });
    await app.close();
  });

  it("rejects leaders outside management", async () => {
    const { app, cookie } = await setup("LEADER");
    const response = await app.inject({ method: "GET", url: "/api/audit-events", headers: { cookie } });
    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
