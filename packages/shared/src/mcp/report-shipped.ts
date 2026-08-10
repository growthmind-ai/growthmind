import { z } from "zod";

import { mcpIdSchema, mcpTimestampSchema } from "./types";

// Strict and carrying no date field in any spelling, so a caller offering the date we answer
// on fails as an unrecognised key rather than being quietly ignored.
export const reportShippedInputSchema = z.strictObject({
  projectId: mcpIdSchema.optional(),

  page: z.string().min(1).max(512),

  description: z.string().min(1).max(512),

  // `.min(1)` is what stops a caller sending the whole-page sentinel and colliding with the
  // page-level row.
  control: z.string().min(1).max(512).optional(),
});
export type ReportShippedInput = z.infer<typeof reportShippedInputSchema>;

export const reportShippedOutputSchema = z.object({
  changeId: mcpIdSchema,

  page: z.string().min(1),

  control: z.string().min(1).nullable(),

  readoutDueAt: mcpTimestampSchema,

  acknowledgement: z.string().min(1),
});
export type ReportShippedOutput = z.infer<typeof reportShippedOutputSchema>;
