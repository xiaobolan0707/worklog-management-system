import { describe, expect, it } from "vitest";

import { ApproverService } from "../../../src/modules/users/approver.service.js";

describe("ApproverService", () => {
  it("preserves the administrator's approver order with one-based positions", () => {
    const service = new ApproverService({
      replaceApprovers: async () => undefined,
      listAuthorizedEmployeeIds: async () => []
    });

    expect(service.orderedAssignments(["leader-b", "leader-a"])).toEqual([
      { approverId: "leader-b", position: 1 },
      { approverId: "leader-a", position: 2 }
    ]);
  });

  it("rejects duplicate approvers for one employee", () => {
    const service = new ApproverService({
      replaceApprovers: async () => undefined,
      listAuthorizedEmployeeIds: async () => []
    });

    expect(() => service.orderedAssignments(["leader-a", "leader-a"])).toThrow(
      /duplicate approver/i
    );
  });
});
