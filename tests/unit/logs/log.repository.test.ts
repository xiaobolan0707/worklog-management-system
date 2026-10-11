import { describe, expect, it } from "vitest";

import { PrismaLogRepository } from "../../../src/modules/logs/log.repository.js";

describe("PrismaLogRepository", () => {
  it("returns the employee name with scoped log results", async () => {
    const database = {
      dailyLog: {
        findMany: async () => [
          {
            id: "log-1",
            employeeId: "employee-1",
            employee: { displayName: "张三", username: "zhangsan" },
            workDate: new Date("2026-10-11T00:00:00.000Z"),
            status: "ARCHIVED",
            color: "RED",
            version: 2,
            submissionCount: 1,
            items: [],
            approvalSteps: [],
            versions: []
          }
        ]
      }
    };
    const repository = new PrismaLogRepository(database as never);

    await expect(repository.listScoped(null)).resolves.toMatchObject([
      { employeeId: "employee-1", employeeName: "张三" }
    ]);
  });
});
