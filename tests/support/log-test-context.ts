import type { FastifyInstance } from "fastify";

import { buildApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { hashPassword } from "../../src/modules/auth/password.js";
import { InMemoryAdministrationRepository } from "./in-memory-administration-repository.js";
import { InMemoryAuthRepository } from "./in-memory-auth-repository.js";
import { InMemoryLogRepository } from "./in-memory-log-repository.js";
import { InMemoryReminderRepository } from "./in-memory-reminder-repository.js";

export const logTestEnv = loadEnv({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://worklog:secret@localhost:5432/worklog",
  SESSION_SECRET: "a-secure-session-secret-with-32-characters"
});

export async function createLogTestContext() {
  const authRepository = new InMemoryAuthRepository();
  for (const user of [
    { id: "employee-1", username: "employee", role: "EMPLOYEE" as const },
    { id: "employee-2", username: "other", role: "EMPLOYEE" as const },
    { id: "leader-1", username: "leader", role: "LEADER" as const }
  ]) {
    authRepository.addUser({
      ...user,
      displayName: user.username,
      passwordHash: await hashPassword("User-password-42"),
      accountStatus: "ACTIVE",
      mustChangePassword: false,
      failedLoginCount: 0,
      lockedUntil: null
    });
  }
  const administrationRepository = new InMemoryAdministrationRepository(authRepository);
  administrationRepository.approvers.set("employee-1", [{ approverId: "leader-1", position: 1 }]);
  const reminderRepository = new InMemoryReminderRepository();
  const logRepository = new InMemoryLogRepository(reminderRepository);
  logRepository.approvers.set("employee-1", [{ approverId: "leader-1", position: 1 }]);
  const app = await buildApp({
    env: logTestEnv,
    authRepository,
    administrationRepository,
    logRepository,
    reminderRepository
  });
  return { app, authRepository, administrationRepository, logRepository, reminderRepository };
}

export async function loginAs(app: FastifyInstance, username: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username, password: "User-password-42" }
  });
  const header = response.headers["set-cookie"];
  const values = Array.isArray(header) ? header : [String(header)];
  return {
    cookie: values.find((value) => value.startsWith("worklog_session="))?.split(";")[0] ?? "",
    csrfToken: response.json<{ csrfToken: string }>().csrfToken
  };
}
