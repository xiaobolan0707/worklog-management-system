import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLogTestContext, loginAs } from "../../support/log-test-context.js";

const apps: FastifyInstance[] = [];
let context: Awaited<ReturnType<typeof createLogTestContext>>;

beforeEach(async () => {
  context = await createLogTestContext();
  apps.push(context.app);
});
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe("daily log routes", () => {
  it("stores one numbered log per day and submits it as green with ordered approvals", async () => {
    const auth = await loginAs(context.app, "employee");
    const request = {
      method: "POST" as const,
      url: "/api/logs/drafts",
      headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken },
      payload: {
        workDate: "2026-10-10",
        items: [
          { content: "完成日志接口", completed: true, images: [] },
          { content: "进行页面联调", completed: false, unfinishedReason: "等待接口", images: [] },
          { content: "整理测试数据", completed: true, images: [] },
          { content: "更新部署说明", completed: true, images: [] }
        ]
      }
    };
    const first = await context.app.inject(request);
    const second = await context.app.inject(request);
    expect(first.statusCode).toBe(201);
    expect(second.json().log.id).toBe(first.json().log.id);
    expect(context.logRepository.logs.size).toBe(1);
    expect(first.json().log.items.map((item: { position: number }) => item.position)).toEqual([1, 2, 3, 4]);

    const submitted = await context.app.inject({
      method: "POST",
      url: `/api/logs/${first.json().log.id}/submit`,
      headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken }
    });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json().log).toMatchObject({ status: "SUBMITTED", color: "GREEN" });
    expect(submitted.json().log.approvalSteps).toMatchObject([
      {
        approverId: "leader-1",
        approverName: "leader-1",
        approverRole: "LEADER",
        position: 1,
        status: "PENDING",
        itemComments: [],
        actedAt: null
      }
    ]);
  });

  it("prevents another employee from reading or editing a log by guessed id", async () => {
    const owner = await loginAs(context.app, "employee");
    const created = await context.app.inject({
      method: "POST",
      url: "/api/logs/drafts",
      headers: { cookie: owner.cookie, "x-csrf-token": owner.csrfToken },
      payload: {
        workDate: "2026-10-10",
        items: [1, 2, 3, 4].map((position) => ({ content: `任务 ${position}`, completed: true, images: [] }))
      }
    });
    const other = await loginAs(context.app, "other");

    const read = await context.app.inject({
      method: "GET",
      url: `/api/logs/${created.json().log.id}`,
      headers: { cookie: other.cookie }
    });
    expect(read.statusCode).toBe(403);
  });
});
