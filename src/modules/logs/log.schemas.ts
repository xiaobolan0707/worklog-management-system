import { z } from "zod";

const logItemSchema = z
  .object({
    content: z.string().trim().min(1).max(2000),
    completed: z.boolean(),
    unfinishedReason: z.string().trim().max(1000).optional()
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
  items: z.array(logItemSchema).min(1).max(50)
});

export type LogDraftPayload = z.infer<typeof logDraftSchema>;
