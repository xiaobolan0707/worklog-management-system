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
        planTarget: "完成本周接口联调",
        planDueAt: "2026-10-10T10:00:00.000Z",
        items: [
          { content: "今天完成日志接口开发并进行了完整测试确认工作", completed: true, images: [] },
          { content: "今天进行页面联调并记录所有待处理问题与结果", completed: false, unfinishedReason: "等待接口", images: [] },
          { content: "今天整理全部测试数据并复核最终输出结果无误", completed: true, images: [] },
          { content: "今天更新生产部署说明并补充完整操作步骤内容", completed: true, images: [] }
        ]
      }
    };
    const first = await context.app.inject(request);
    const second = await context.app.inject({
      ...request,
      payload: { workDate: request.payload.workDate, items: request.payload.items }
    });
    expect(first.statusCode).toBe(201);
    expect(second.json().log.id).toBe(first.json().log.id);
    expect(context.logRepository.logs.size).toBe(1);
    expect(first.json().log).toMatchObject({
      planTarget: "完成本周接口联调",
      planDueAt: "2026-10-10T10:00:00.000Z"
    });
    expect(second.json().log).toMatchObject({
      planTarget: "完成本周接口联调",
      planDueAt: "2026-10-10T10:00:00.000Z"
    });
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

  it("lets the owner reply to a leader comment and sends that leader an unread reminder", async () => {
    const employee = await loginAs(context.app, "employee");
    const leader = await loginAs(context.app, "leader");
    const other = await loginAs(context.app, "other");
    const created = await context.app.inject({
      method: "POST", url: "/api/logs/drafts",
      headers: { cookie: employee.cookie, "x-csrf-token": employee.csrfToken },
      payload: { workDate: "2026-10-10", items: [1, 2, 3, 4].map(() => ({ content: "已经完成项目接口联调和所有异常情况验证工作", completed: true, images: [] })) }
    });
    const logId = created.json().log.id;
    const log = context.logRepository.logs.get(logId)!;
    log.approvalSteps = [{
      id: "step-1", approverId: "leader-1", approverName: "领导", approverRole: "LEADER",
      position: 1, status: "APPROVED", color: "RED", comment: null,
      itemComments: [{ itemPosition: 1, comment: "请说明测试结果" }], replies: [],
      actedAt: "2026-10-10T02:00:00.000Z"
    }];
    const url = `/api/logs/${logId}/replies`;
    const payload = { stepId: "step-1", itemPosition: 1, content: "已覆盖正常和异常流程，结果通过。" };
    const headers = { cookie: employee.cookie, "x-csrf-token": employee.csrfToken };

    expect((await context.app.inject({ method: "POST", url, headers: { cookie: other.cookie, "x-csrf-token": other.csrfToken }, payload })).statusCode).toBe(403);
    expect((await context.app.inject({ method: "POST", url, headers: { cookie: leader.cookie, "x-csrf-token": leader.csrfToken }, payload })).statusCode).toBe(403);
    expect((await context.app.inject({ method: "POST", url, headers, payload: { ...payload, stepId: "missing" } })).statusCode).toBe(404);
    expect((await context.app.inject({ method: "POST", url, headers, payload: { ...payload, content: "   " } })).statusCode).toBe(400);
    log.approvalSteps[0]!.status = "PENDING";
    expect((await context.app.inject({ method: "POST", url, headers, payload })).statusCode).toBe(404);
    log.approvalSteps[0]!.status = "APPROVED";

    const reply = await context.app.inject({ method: "POST", url, headers, payload });
    expect(reply.statusCode).toBe(201);
    expect(reply.json().log.approvalSteps[0].replies).toMatchObject([{ itemPosition: 1, content: payload.content }]);
    for (const cookie of [employee.cookie, leader.cookie]) {
      const detail = await context.app.inject({ method: "GET", url: `/api/logs/${logId}`, headers: { cookie } });
      expect(detail.json().log.approvalSteps[0].replies).toMatchObject([{ itemPosition: 1, content: payload.content }]);
    }
    context.administrationRepository.approvers.set("employee-1", []);
    const formerApproverDetail = await context.app.inject({ method: "GET", url: `/api/logs/${logId}`, headers: { cookie: leader.cookie } });
    expect(formerApproverDetail.statusCode).toBe(200);
    const reminders = await context.app.inject({ method: "GET", url: "/api/reminders", headers: { cookie: leader.cookie } });
    expect(reminders.json().reminders).toMatchObject([{
      kind: "COMMENT_REPLY", recipientId: "leader-1", relatedLogId: logId, readAt: null
    }]);
    const reminderId = reminders.json().reminders[0].id;
    const read = await context.app.inject({
      method: "POST", url: `/api/reminders/${reminderId}/read`,
      headers: { cookie: leader.cookie, "x-csrf-token": leader.csrfToken }
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().reminder.readAt).not.toBeNull();
    const stillUnreadForEmployee = await context.app.inject({ method: "GET", url: "/api/reminders", headers: { cookie: employee.cookie } });
    expect(stillUnreadForEmployee.json().reminders).toEqual([]);
  });
});
