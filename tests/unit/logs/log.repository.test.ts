import { describe, expect, it } from "vitest";

import { PrismaLogRepository } from "../../../src/modules/logs/log.repository.js";

describe("PrismaLogRepository", () => {
  it("treats an invalid date search as text instead of sending an invalid date to the database", async () => {
    const database = { dailyLog: {
      findMany: async ({ where }: { where: { OR: { workDate?: Date }[] } }) => {
        if (where.OR.some((condition) => condition.workDate && Number.isNaN(condition.workDate.getTime()))) {
          throw new Error("invalid database date");
        }
        return [];
      },
      count: async () => 0
    } };
    const repository = new PrismaLogRepository(database as never);
    await expect(repository.listScoped(null, { page: 1, pageSize: 20, search: "2026-99-99" }))
      .resolves.toMatchObject({ logs: [], total: 0 });
  });

  it("paginates log summaries without loading image or version payloads", async () => {
    const rows = [1, 2].map((number) => ({
      id: `log-${number}`, employeeId: "employee-1",
      employee: { displayName: "张三", username: "zhangsan" },
      workDate: new Date(`2026-10-${String(number).padStart(2, "0")}T00:00:00.000Z`),
      status: "ARCHIVED", color: "RED", planTarget: null, planDueAt: null,
      items: [{ images: [{ dataUrl: "large-image" }] }], versions: [{ snapshot: "large-image" }]
    }));
    const database = {
      dailyLog: {
        findMany: async ({ skip, take }: { skip: number; take: number }) => rows.slice(skip, skip + take),
        count: async () => rows.length
      }
    };
    const repository = new PrismaLogRepository(database as never);
    const result = await repository.listScoped(null, { page: 2, pageSize: 1, search: "" });
    expect(result).toMatchObject({ total: 2, page: 2, pageSize: 1, logs: [{ id: "log-2" }] });
    expect(JSON.stringify(result)).not.toContain("large-image");
  });

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
            planTarget: "完成周报",
            planDueAt: new Date("2026-10-11T10:00:00.000Z"),
            items: [],
            approvalSteps: [],
            versions: []
          }
        ],
        count: async () => 1
      }
    };
    const repository = new PrismaLogRepository(database as never);

    await expect(repository.listScoped(null, { page: 1, pageSize: 20, search: "" })).resolves.toMatchObject({ logs: [
      {
        employeeId: "employee-1",
        employeeName: "张三",
        planTarget: "完成周报",
        planDueAt: "2026-10-11T10:00:00.000Z"
      }
    ] });
  });
});
