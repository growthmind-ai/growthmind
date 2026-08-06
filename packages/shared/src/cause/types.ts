import { z } from "zod";

import { summaryFailureCodeSchema, summaryUsageSchema } from "../summary/types";

// Storage/prompt-sizing constants, not trust-bearing (ADD Decision 5 — same status
// as O-043's DIVERGENCE_ANCHOR_SESSION_LIMIT; decided, not escalated).
export const CAUSE_CLAIM_MAX_CITED_BEATS = 5;
export const CAUSE_MODEL_MAX_CLAIMS = 5;

export const causeClaimOutputSchema = z.strictObject({
  statement: z.string().min(1),
  citesBeats: z.array(z.number().int().nonnegative()).max(CAUSE_CLAIM_MAX_CITED_BEATS).readonly(),
});
export type CauseClaimOutput = z.infer<typeof causeClaimOutputSchema>;

export const causeModelOutputSchema = z.strictObject({
  claims: z.array(causeClaimOutputSchema).max(CAUSE_MODEL_MAX_CLAIMS).readonly(),
});
export type CauseModelOutput = z.infer<typeof causeModelOutputSchema>;

export const causeRenderResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),

    claims: z.array(causeClaimOutputSchema).readonly(),
    resolvedModelId: z.string(),
    usage: summaryUsageSchema,
  }),
  z.object({
    ok: z.literal(false),
    code: summaryFailureCodeSchema,

    message: z.string(),
    resolvedModelId: z.string(),
    usage: summaryUsageSchema,
  }),
]);
export type CauseRenderResult = z.infer<typeof causeRenderResultSchema>;
