import { z } from "zod";

export const approvalDecisionSchema = z.object({
  color: z.enum(["RED", "GRAY"]),
  comment: z.string().trim().max(2000).default("")
});

export const returnSchema = z.object({
  comment: z.string().trim().min(1).max(2000)
});

export const colorChangeSchema = z.object({
  color: z.enum(["RED", "GRAY"]),
  reason: z.string().trim().min(1).max(2000)
});
