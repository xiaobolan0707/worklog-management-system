import { describe, expect, it } from "vitest";

import { logDraftSchema } from "../../../src/modules/logs/log.schemas.js";

describe("daily log validation", () => {
  it("rejects empty work items", () => {
    expect(() =>
      logDraftSchema.parse({
        workDate: "2026-10-10",
        items: [{ content: "   ", completed: true }]
      })
    ).toThrow();
  });

  it("requires a reason for every unfinished item", () => {
    expect(() =>
      logDraftSchema.parse({
        workDate: "2026-10-10",
        items: [{ content: "完成接口联调", completed: false, unfinishedReason: "" }]
      })
    ).toThrow(/unfinished reason/i);
  });

  it("accepts completed and explained unfinished items", () => {
    expect(
      logDraftSchema.parse({
        workDate: "2026-10-10",
        items: [
          { content: "完成登录页", completed: true },
          { content: "完成联调", completed: false, unfinishedReason: "等待测试环境" }
        ]
      }).items
    ).toHaveLength(2);
  });
});
