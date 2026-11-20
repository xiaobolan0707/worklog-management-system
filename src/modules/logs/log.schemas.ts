import { z } from "zod";

import { effectiveCharacterCount } from "../../shared/text.js";

const imageTypeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);

/** 单张图片原始字节上限；base64 膨胀约 4/3，故 dataUrl 字符上限取 14MB 留余量。 */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_DATA_URL_CHARS = 14_000_000;

/** 从 data URL 反推真实解码字节数。 */
function decodedImageBytes(dataUrl: string) {
  const comma = dataUrl.indexOf(",");
  return comma < 0 ? 0 : Buffer.byteLength(dataUrl.slice(comma + 1), "base64");
}

export const logImageSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  type: imageTypeSchema,
  /**
   * 兼容字段，不参与校验。客户端上报值只可能是估算结果（历史上用 base64 长度 ×0.75，
   * 漏算 padding 会偏差 1–2 字节），据此判定「伪造」会直接把日志卡在无法保存的状态。
   * 真实字节数一律由 dataUrl 反推。
   */
  size: z.number().int().positive().optional(),
  dataUrl: z.string().min(1).max(MAX_IMAGE_DATA_URL_CHARS).regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/)
}).superRefine((image, context) => {
  if (!image.dataUrl.startsWith(`data:${image.type};base64,`)) {
    context.addIssue({ code: "custom", message: "image type does not match data", path: ["type"] });
    return;
  }
  const bytes = decodedImageBytes(image.dataUrl);
  if (bytes <= 0) {
    context.addIssue({ code: "custom", message: "image data is empty", path: ["dataUrl"] });
  } else if (bytes > MAX_IMAGE_BYTES) {
    context.addIssue({ code: "custom", message: "image exceeds 10MB", path: ["dataUrl"] });
  }
}).transform((image) => ({
  // 输出侧统一为真实字节数，下游的 20MB 预算、存储与展示都不再依赖客户端声明。
  ...image,
  size: decodedImageBytes(image.dataUrl)
}));

const logItemSchema = z
  .object({
    content: z.string().trim().max(2000),
    completed: z.boolean(),
    unfinishedReason: z.string().trim().max(1000).optional(),
    images: z.array(logImageSchema).max(6).default([])
  })
  .superRefine((item, context) => {
    if (!item.completed && !item.unfinishedReason) {
      context.addIssue({
        code: "custom",
        message: "unfinished reason is required",
        path: ["unfinishedReason"]
      });
    }
  });

/** PERF-01：单条日志图片原始字节总量上限，避免 base64 内联造成存储与响应放大。 */
export const LOG_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;

/** 版本快照只保留图片元信息，不再复制 base64 内容（PERF-01）。 */
export function snapshotImages(images: LogImagePayload[]) {
  return images.map(({ id, name, type, size }) => ({ id, name, type, size }));
}

export const logDraftSchema = z.object({
  workDate: z.iso.date(),
  planTarget: z.string().trim().max(500).nullable().optional(),
  planDueAt: z.iso.datetime({ offset: true }).nullable().optional(),
  items: z.array(logItemSchema).min(4).max(50)
}).superRefine((draft, context) => {
  const totalBytes = draft.items
    .flatMap((item) => item.images)
    .reduce((sum, image) => sum + image.size, 0);
  if (totalBytes > LOG_TOTAL_IMAGE_BYTES) {
    context.addIssue({
      code: "custom",
      message: "images exceed the 20MB per-log budget",
      path: ["items"]
    });
  }
});

export const logSubmissionItemsSchema = z.array(
  logItemSchema.superRefine((item, context) => {
    if (effectiveCharacterCount(item.content) < 20) {
      context.addIssue({ code: "custom", message: "content must contain at least 20 characters", path: ["content"] });
    }
  })
).min(4).max(50);

export type LogDraftPayload = z.infer<typeof logDraftSchema>;
export type LogImagePayload = z.infer<typeof logImageSchema>;
