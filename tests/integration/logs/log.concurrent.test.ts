import { describe, expect, it } from "vitest";

import { createLogTestContext, loginAs } from "../../support/log-test-context.js";

describe("concurrent daily log submission", () => {
  it("allows one state transition and one submit audit event", async () => {
    const context = await createLogTestContext();
    const auth = await loginAs(context.app, "employee");
    const created = await context.app.inject({
      method: "POST",
      url: "/api/logs/drafts",
      headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      payload: {
        workDate: "2026-10-10",
        items: [1, 2, 3, 4].map((position) => ({ content: `今天完成第${position}项功能开发并进行了完整测试确认工作`, completed: true, images: [] }))
      }
    });

    const responses = await Promise.all([
      context.app.inject({
        method: "POST",
        url: `/api/logs/${created.json().log.id}/submit`,
        headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken }
      }),
      context.app.inject({
        method: "POST",
        url: `/api/logs/${created.json().log.id}/submit`,
        headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken }
      })
    ]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect(context.logRepository.logs.size).toBe(1);
    expect(context.logRepository.audits.filter((event) => event.action === "LOG_SUBMITTED")).toHaveLength(1);
    await context.app.close();
  });
});
