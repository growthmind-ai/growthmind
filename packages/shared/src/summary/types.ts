import { z } from "zod";

export const analysisRunStatusSchema = z.enum(["running", "completed", "failed"]);
export type AnalysisRunStatus = z.infer<typeof analysisRunStatusSchema>;

export const analysisOutcomeSchema = z.enum([
  "produced_findings",

  "no_candidates_passed_gate",

  "no_sessions_to_analyse",
]);
export type AnalysisOutcome = z.infer<typeof analysisOutcomeSchema>;

export const analysisStopReasonSchema = z.enum([
  "ran_to_completion",

  "cap_exhausted",

  "fatal_error",
]);
export type AnalysisStopReason = z.infer<typeof analysisStopReasonSchema>;

export const summarySourceSchema = z.enum([
  "model_rendered",

  "floor_no_key_configured",

  "floor_cap_exhausted",

  "floor_model_call_failed",

  "floor_model_output_invalid",

  "floor_model_text_rejected",
]);
export type SummarySource = z.infer<typeof summarySourceSchema>;

export const summaryFailureCodeSchema = z.enum(["output_invalid", "call_failed"]);
export type SummaryFailureCode = z.infer<typeof summaryFailureCodeSchema>;

export const summaryUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
});
export type SummaryUsage = z.infer<typeof summaryUsageSchema>;

export const summaryRenderResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),

    headline: z.string(),
    context: z.string(),
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
export type SummaryRenderResult = z.infer<typeof summaryRenderResultSchema>;
