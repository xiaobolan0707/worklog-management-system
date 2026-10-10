import { describe, expect, it } from "vitest";

import { RewardService } from "../../../src/modules/reports/reward.service.js";

describe("reward confirmation", () => {
  it("requires an authorized leader and writes an audit record", async () => {
    const decisions: unknown[] = [];
    const audits: unknown[] = [];
    const service = new RewardService({
      canConfirm: async (actorId, employeeId) => actorId === "leader-1" && employeeId === "employee-1",
      saveDecision: async (input) => {
        decisions.push(input);
        return { id: "decision-1", ...input };
      },
      appendAudit: async (input) => {
        audits.push(input);
      }
    });
    const input = {
      employeeId: "employee-1",
      periodType: "MONTHLY" as const,
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      redCount: 8,
      grayCount: 2,
      note: "月度奖励"
    };

    await expect(service.confirm("leader-2", input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.confirm("leader-1", input)).resolves.toMatchObject({ outcome: "REWARD" });
    expect(decisions).toHaveLength(1);
    expect(audits).toHaveLength(1);
  });
});
