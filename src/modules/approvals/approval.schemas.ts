import { z } from "zod";

export const itemCommentSchema = z.object({
  itemPosition: z.number().int().positive(),
  comment: z.string().trim().min(1).max(1000)
});

export const approvalDecisionSchema = z.object({
  color: z.enum(["RED", "GRAY"]),
  itemComments: z.array(itemCommentSchema).min(1).max(50)
});

export const returnSchema = z.object({
  itemComments: z.array(itemCommentSchema).min(1).max(50)
});

export const colorChangeSchema = z.object({
  color: z.enum(["RED", "GRAY"]),
  reason: z.string().trim().min(1).max(2000)
});
