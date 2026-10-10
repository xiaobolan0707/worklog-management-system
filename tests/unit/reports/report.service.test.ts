import { describe, expect, it } from "vitest";

import {
  buildPeriodStats,
  periodRange
} from "../../../src/modules/reports/report.service.js";
import { recommendReward } from "../../../src/modules/reports/reward.service.js";

describe("period reports", () => {
  it("builds monthly, quarterly, and yearly ranges on Beijing calendar dates", () => {
    expect(periodRange("MONTHLY", "2026-10-10")).toEqual({ start: "2026-10-01", end: "2026-10-31" });
    expect(periodRange("QUARTERLY", "2026-10-10")).toEqual({ start: "2026-10-01", end: "2026-12-31" });
    expect(periodRange("YEARLY", "2026-10-10")).toEqual({ start: "2026-01-01", end: "2026-12-31" });
  });

  it("returns safe zero rates when there are no logs", () => {
    expect(buildPeriodStats([])).toEqual({
      total: 0,
      redCount: 0,
      grayCount: 0,
      returnCount: 0,
      onTimeRate: 0,
      completionRate: 0
    });
  });

  it("calculates red/gray completion and never emits a score", () => {
    const stats = buildPeriodStats([
      { color: "RED", submittedOnTime: true, returnCount: 0 },
      { color: "RED", submittedOnTime: true, returnCount: 1 },
      { color: "RED", submittedOnTime: false, returnCount: 0 },
      { color: "GRAY", submittedOnTime: false, returnCount: 2 }
    ]);

    expect(stats).toEqual({
      total: 4,
      redCount: 3,
      grayCount: 1,
      returnCount: 3,
      onTimeRate: 50,
      completionRate: 75
    });
    expect(stats).not.toHaveProperty("score");
  });
});

describe("reward recommendation", () => {
  it("rewards when red is greater and recommends improvement when gray is not lower", () => {
    expect(recommendReward({ redCount: 4, grayCount: 2 })).toBe("REWARD");
    expect(recommendReward({ redCount: 2, grayCount: 2 })).toBe("IMPROVEMENT");
    expect(recommendReward({ redCount: 0, grayCount: 0 })).toBe("REWARD");
  });
});
