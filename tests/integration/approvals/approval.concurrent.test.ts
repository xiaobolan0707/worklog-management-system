import { describe, expect, it } from "vitest";

import { ApprovalService } from "../../../src/modules/approvals/approval.service.js";
import { InMemoryApprovalRepository } from "../../support/in-memory-approval-repository.js";

describe("concurrent approval", () => {
  it("commits one transition and one audit event", async () => {
    const repository = new InMemoryApprovalRepository();
    repository.addSubmittedLog({
      id: "log-1",
      employeeId: "employee-1",
      workDate: "2026-10-10",
      approverIds: ["leader-1"]
    });
    const service = new ApprovalService(repository, () => new Date("2026-10-10T04:00:00.000Z"));

    const results = await Promise.allSettled([
      service.approveCurrentStep("log-1", "leader-1", "RED", "ok"),
      service.approveCurrentStep("log-1", "leader-1", "RED", "ok")
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(repository.audits.filter((event) => event.action === "LOG_APPROVED")).toHaveLength(1);
  });
});
