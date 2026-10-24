import { describe, expect, it } from "vitest";

import {
  buildPeriodStats,
  periodRange,
  PrismaReportRepository
} from "../../../src/modules/reports/report.service.js";
import { recommendReward } from "../../../src/modules/reports/reward.service.js";

describe("period reports", () => {
  it("counts Beijing submissions before the configured deadline as on time", async () => {
    const repository = new PrismaReportRepository({
      dailyLog: { findMany: async () => [
        { workDate: new Date("2026-10-10T00:00:00.000Z"), submittedAt: new Date("2026-10-09T16:30:00.000Z"), status: "ARCHIVED", color: "RED", approvalSteps: [], versions: [] },
        { workDate: new Date("2026-10-10T00:00:00.000Z"), submittedAt: new Date("2026-10-10T12:00:00.000Z"), status: "ARCHIVED", color: "GRAY", approvalSteps: [], versions: [] }
      ] }
    } as never, async () => ({
      submissionDeadline: "18:00", reminderMinutesBefore: 30,
      approvalDeadline: "12:00", timezone: "Asia/Shanghai"
    }));
    await expect(repository.listStats(null, "2026-10-01", "2026-10-31"))
      .resolves.toMatchObject([{ submittedOnTime: true }, { submittedOnTime: false }]);
  });

  it("does not count a first approver's color as the final result", async () => {
    const repository = new PrismaReportRepository({ dailyLog: { findMany: async () => [{
      workDate: new Date("2026-10-10T00:00:00.000Z"),
      submittedAt: new Date("2026-10-10T06:00:00.000Z"),
      status: "IN_REVIEW", color: "RED", approvalSteps: [], versions: []
    }] } } as never, async () => ({
      submissionDeadline: "18:00", reminderMinutesBefore: 30,
      approvalDeadline: "12:00", timezone: "Asia/Shanghai"
    }));
    await expect(repository.listStats(null, "2026-10-01", "2026-10-31"))
      .resolves.toMatchObject([{ color: null }]);
  });

  it("keeps an on-time first submission on time after a returned log is resubmitted", async () => {
    const repository = new PrismaReportRepository({ dailyLog: { findMany: async () => [{
      workDate: new Date("2026-10-10T00:00:00.000Z"),
      submittedAt: new Date("2026-10-11T06:00:00.000Z"),
      versions: [{ createdAt: new Date("2026-10-10T09:00:00.000Z") }],
      status: "ARCHIVED", color: "RED", approvalSteps: []
    }] } } as never, async () => ({
      submissionDeadline: "18:00", reminderMinutesBefore: 30,
      approvalDeadline: "12:00", timezone: "Asia/Shanghai"
    }));
    await expect(repository.listStats(null, "2026-10-01", "2026-10-31"))
      .resolves.toMatchObject([{ submittedOnTime: true }]);
  });

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
