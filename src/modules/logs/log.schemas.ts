import { z } from "zod";

const imageTypeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);

export const logImageSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  type: imageTypeSchema,
  size: z.number().int().positive().max(10 * 1024 * 1024),
  dataUrl: z.string().max(14_000_000).regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/)
}).superRefine((image, context) => {
  if (!image.dataUrl.startsWith(`data:${image.type};base64,`)) {
    context.addIssue({ code: "custom", message: "image type does not match data", path: ["type"] });
  }
  const base64 = image.dataUrl.slice(image.dataUrl.indexOf(",") + 1);
  if (Buffer.byteLength(base64, "base64") !== image.size) {
    context.addIssue({ code: "custom", message: "image size does not match data", path: ["size"] });
  }
});

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

export const logDraftSchema = z.object({
  workDate: z.iso.date(),
  items: z.array(logItemSchema).min(4).max(50)
});

export const logSubmissionItemsSchema = z.array(
  logItemSchema.superRefine((item, context) => {
    if (!item.content && item.images.length === 0) {
      context.addIssue({ code: "custom", message: "content or image is required" });
    }
  })
).min(4).max(50);

export type LogDraftPayload = z.infer<typeof logDraftSchema>;
export type LogImagePayload = z.infer<typeof logImageSchema>;
