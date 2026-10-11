import { describe, expect, it } from "vitest";

import {
  ApprovalService,
  PrismaApprovalRepository
} from "../../../src/modules/approvals/approval.service.js";
import { InMemoryApprovalRepository } from "../../support/in-memory-approval-repository.js";

function setup(workDate = "2026-10-10", now = "2026-10-10T04:00:00.000Z") {
  const repository = new InMemoryApprovalRepository();
  repository.addSubmittedLog({
    id: "log-1",
    employeeId: "employee-1",
    workDate,
    approverIds: ["leader-1", "leader-2"]
  });
  return {
    repository,
    service: new ApprovalService(repository, () => new Date(now))
  };
}

describe("ApprovalService", () => {
  it("returns submitted work items for the leader review queue", async () => {
    const database = {
      dailyLog: {
        findUnique: async () => ({
          id: "log-1",
          employeeId: "employee-1",
          workDate: new Date("2026-10-10T00:00:00.000Z"),
          status: "SUBMITTED",
          color: "GREEN",
          submissionCount: 1,
          version: 1,
          items: [
            {
              position: 1,
              content: "完成登录接口",
              completed: true,
              unfinishedReason: null
            }
          ],
          approvalSteps: [
            {
              approverId: "leader-1",
              position: 1,
              submissionNumber: 1,
              status: "PENDING",
              color: null,
              comment: null
            }
          ]
        })
      }
    };
    const repository = new PrismaApprovalRepository(database as never);

    await expect(repository.findApprovalLog("log-1")).resolves.toMatchObject({
      items: [
        {
          position: 1,
          content: "完成登录接口",
          completed: true,
          unfinishedReason: null
        }
      ]
    });
  });

  it("enforces approval order and archives after the final red/gray decision", async () => {
    const { repository, service } = setup();
    await expect(service.approveCurrentStep("log-1", "leader-2", "RED", "完成")).rejects.toMatchObject({
      code: "NOT_CURRENT_APPROVER"
    });

    const first = await service.approveCurrentStep("log-1", "leader-1", "RED", "完成");
    expect(first).toMatchObject({ status: "IN_REVIEW", color: "RED" });
    expect(first).not.toHaveProperty("score");

    const final = await service.approveCurrentStep("log-1", "leader-2", "GRAY", "未完成");
    expect(final).toMatchObject({ status: "ARCHIVED", color: "GRAY" });
    expect(repository.audits.filter((event) => event.action === "LOG_APPROVED")).toHaveLength(2);
  });

  it("allows review on the work date or following day and rejects later review", async () => {
    const current = setup();
    await expect(
      current.service.approveCurrentStep("log-1", "leader-1", "GREEN" as "RED", "x")
    ).rejects.toMatchObject({ code: "INVALID_COLOR" });

    const followingDay = setup("2026-10-10", "2026-10-11T04:00:00.000Z");
    await expect(
      followingDay.service.approveCurrentStep("log-1", "leader-1", "RED", "次日核查完成")
    ).resolves.toMatchObject({ color: "RED" });

    const late = setup("2026-10-09", "2026-10-11T04:00:00.000Z");
    await expect(
      late.service.approveCurrentStep("log-1", "leader-1", "RED", "x")
    ).rejects.toMatchObject({ code: "APPROVAL_DATE_EXPIRED" });
  });

  it("requires a reason when an authorized leader changes an archived color", async () => {
    const { service } = setup();
    await service.approveCurrentStep("log-1", "leader-1", "RED", "ok");
    await service.approveCurrentStep("log-1", "leader-2", "RED", "ok");

    await expect(service.changeReviewedColor("log-1", "leader-1", "GRAY", "")).rejects.toMatchObject({
      code: "COLOR_CHANGE_REASON_REQUIRED"
    });
    await expect(
      service.changeReviewedColor("log-1", "leader-1", "GRAY", "后续核查发现未完成")
    ).resolves.toMatchObject({ color: "GRAY" });
  });
});
