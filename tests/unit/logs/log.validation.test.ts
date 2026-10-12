import { describe, expect, it } from "vitest";

import {
  logDraftSchema,
  logImageSchema,
  logSubmissionItemsSchema
} from "../../../src/modules/logs/log.schemas.js";

const fourItems = [1, 2, 3, 4].map((position) => ({
  content: `工作事项 ${position}`,
  completed: true,
  images: []
}));

describe("daily log validation", () => {
  it("keeps four incomplete rows in a draft but rejects them at submission", () => {
    const items = [1, 2, 3, 4].map(() => ({ content: "", completed: true, images: [] }));
    expect(logDraftSchema.parse({ workDate: "2026-10-10", items }).items).toHaveLength(4);
    expect(() => logSubmissionItemsSchema.parse(items)).toThrow(/content or image/i);
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

  it("accepts four valid items and a supported image", () => {
    expect(
      logSubmissionItemsSchema.parse([
        {
          content: "",
          completed: true,
          images: [{
            id: "image-1",
            name: "现场.png",
            type: "image/png",
            size: 3,
            dataUrl: "data:image/png;base64,YWJj"
          }]
        },
        ...fourItems.slice(1)
      ])
    ).toHaveLength(4);
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
