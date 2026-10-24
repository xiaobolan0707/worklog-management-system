import { describe, expect, it } from "vitest";

import {
  logDraftSchema,
  logImageSchema,
  logSubmissionItemsSchema
} from "../../../src/modules/logs/log.schemas.js";

const fourItems = [1, 2, 3, 4].map((position) => ({
  content: `今天完成第${position}项工作内容并进行了全面检查确认无误`,
  completed: true,
  images: []
}));

describe("daily log validation", () => {
  it("keeps four incomplete rows in a draft but rejects them at submission", () => {
    const items = [1, 2, 3, 4].map(() => ({ content: "", completed: true, images: [] }));
    expect(logDraftSchema.parse({ workDate: "2026-10-10", items }).items).toHaveLength(4);
    expect(() => logSubmissionItemsSchema.parse(items)).toThrow(/20/i);
  });

  it("accepts an optional work plan and rejects invalid plan values", () => {
    const parsed = logDraftSchema.parse({
      workDate: "2026-10-16",
      items: fourItems,
      planTarget: "完成客户资料整理",
      planDueAt: "2026-10-16T10:00:00.000Z"
    });

    expect(parsed).toMatchObject({
      planTarget: "完成客户资料整理",
      planDueAt: "2026-10-16T10:00:00.000Z"
    });
    expect(() => logDraftSchema.parse({
      workDate: "2026-10-16",
      items: fourItems,
      planTarget: "字".repeat(501),
      planDueAt: "not-a-date"
    })).toThrow();
  });

  it("requires a reason for every unfinished item", () => {
    expect(() =>
      logDraftSchema.parse({
        workDate: "2026-10-10",
        items: [
          { content: "完成接口联调", completed: false, unfinishedReason: "", images: [] },
          ...fourItems.slice(1)
        ]
      })
    ).toThrow(/unfinished reason/i);
  });

  it("requires at least twenty non-whitespace characters in every submitted item", () => {
    expect(() => logSubmissionItemsSchema.parse([
      { content: `${"字 ".repeat(19)}\n\t　`, completed: true, images: [] },
      ...fourItems.slice(1)
    ])).toThrow(/20/);
    expect(logSubmissionItemsSchema.parse([
      { content: "字 ".repeat(20), completed: true, images: [] },
      { content: "😀".repeat(20), completed: true, images: [] },
      ...fourItems.slice(2)
    ])).toHaveLength(4);
  });

  it("rejects unsupported or oversized images and more than six per item", () => {
    const image = {
      id: "image-1",
      name: "现场.gif",
      type: "image/gif",
      size: 10 * 1024 * 1024 + 1,
      dataUrl: "data:image/gif;base64,YWJj"
    };
    expect(() => logDraftSchema.parse({
      workDate: "2026-10-10",
      items: [{ content: "", completed: true, images: Array(7).fill(image) }, ...fourItems.slice(1)]
    })).toThrow();
  });

  it("rejects forged image type or byte size metadata", () => {
    const base = { id: "image-1", name: "现场.png", type: "image/png" as const, size: 3 };
    expect(() => logImageSchema.parse({ ...base, dataUrl: "data:image/jpeg;base64,YWJj" })).toThrow(/type/i);
    expect(() => logImageSchema.parse({ ...base, size: 1, dataUrl: "data:image/png;base64,YWJj" })).toThrow(/size/i);
  });
});
