import { describe, expect, it } from "vitest";

import { RewardService } from "../../../src/modules/reports/reward.service.js";
import { ReportService } from "../../../src/modules/reports/report.service.js";

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
    }, new ReportService({
      listStats: async () => [
        { color: "GRAY", submittedOnTime: true, returnCount: 0 },
        { color: "GRAY", submittedOnTime: true, returnCount: 0 },
        { color: "RED", submittedOnTime: true, returnCount: 0 }
      ]
    }));
    const input = {
      employeeId: "employee-1",
      periodType: "MONTHLY" as const,
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      note: "月度奖励"
    };

    await expect(service.confirm("leader-2", input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.confirm("leader-1", { ...input, periodEnd: "2026-10-30" }))
      .rejects.toMatchObject({ code: "INVALID_PERIOD" });
    await expect(service.confirm("leader-1", input)).resolves.toMatchObject({
      outcome: "IMPROVEMENT", redCount: 1, grayCount: 2
    });
    expect(decisions).toHaveLength(1);
    expect(audits).toHaveLength(1);
  });
});
