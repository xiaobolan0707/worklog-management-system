import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../../src/app.js";
import { InMemoryApprovalRepository } from "../../support/in-memory-approval-repository.js";
import { createLogTestContext, loginAs, logTestEnv } from "../../support/log-test-context.js";

describe("approval routes", () => {
  it("returns 403 without disclosing a guessed unauthorized log", async () => {
    const base = await createLogTestContext();
    const approvalRepository = new InMemoryApprovalRepository();
    approvalRepository.addSubmittedLog({
      id: "secret-log",
      employeeId: "employee-2",
      workDate: "2026-10-10",
      approverIds: ["other-leader"],
      items: [1, 2, 3, 4].map((position) => ({
        position,
        content: `工作事项 ${position}`,
        completed: true,
        unfinishedReason: null,
        images: []
      }))
    });
    const app = await buildApp({
      env: logTestEnv,
      authRepository: base.authRepository,
      administrationRepository: base.administrationRepository,
      logRepository: base.logRepository,
      approvalRepository
    });
    await base.app.close();
    const leader = await loginAs(app, "leader");

    const response = await app.inject({
      method: "POST",
      url: "/api/approvals/secret-log/approve",
      headers: { cookie: leader.cookie, "x-csrf-token": leader.csrfToken },
      payload: {
        color: "RED",
        itemComments: [1, 2, 3, 4].map((itemPosition) => ({ itemPosition, comment: "ok" }))
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain("employee-2");
    await app.close();
  });
});
