import { z } from "zod";

// The cold-start analysis lane's shapes (O-005 D-10, D-1). Zod is the single
// runtime source of truth. This sprint ships NO table and NO migration:
// nothing in `packages/db` references these unions yet. When the lane's run
// table is written, its enum columns WILL BE pinned to these unions via
// `satisfies` (D9) so a typo'd column value is a compile error rather than a
// runtime surprise — that pinning is an inherited obligation of whoever
// writes that schema file. The pattern to copy already exists and does this
// today for the poll-run enums:
// `packages/db/src/schema/session-source-poll-runs.ts:11-27`.
//
// Four closed unions, each TOTAL: no path in this lane may return `null` or
// `undefined` to mean one of these states. That constrains the table when it
// is written: a nullable column may exist only where null is itself a fact
// (`finished_at` before a run ends, `tokens_in`/`tokens_out` when the SDK
// reported no count) — never as a stand-in for a state this file already
// names.
//
// Every member below carries a comment stating what it means to a CUSTOMER,
// not an engineer — `packages/shared/src/summary/messages.ts` turns each one
// into the sentence a screen would actually show, and the completeness audit
// in `__tests__/summary/messages.test.ts` is what keeps the two files from
// drifting apart.

/**
 * Did the run finish? One row per project per analysis tick — but that run
 * table is NOT YET BUILT (D-9). There is no
 * `packages/db/src/schema/analysis-runs.ts`, no migration, and no persistence
 * in this sprint; this union is the shape its `status` column will be pinned
 * to when someone writes it.
 */
export const analysisRunStatusSchema = z.enum([
  /** We are looking at this project's activity right now. A customer landing
   * on a screen mid-run should see "in progress", never a blank. */
  "running",
  /** We finished this check. This says nothing about whether we found
   * anything worth reporting — see `analysis_outcome` for that. */
  "completed",
  /** Something went wrong partway through and we could not finish this
   * check. The plain-English reason travels separately on the run row. */
  "failed",
]);
export type AnalysisRunStatus = z.infer<typeof analysisRunStatusSchema>;

/**
 * What did a completed run find? Distinguishing `no_sessions_to_analyse`
 * from `no_candidates_passed_gate` is FR-18d's minimum bar: "we have not
 * looked yet" and "we looked and your product was quiet" are different
 * answers to the same zero
 * (`packages/db/src/services/connection-state.ts:36-50`).
 */
export const analysisOutcomeSchema = z.enum([
  /** We found at least one thing worth telling this customer about. */
  "produced_findings",
  /** We had activity to look at, ran every check we have, and nothing rose
   * to the bar we require before we will say anything. Not the same as
   * having nothing to look at — see `no_sessions_to_analyse`. */
  "no_candidates_passed_gate",
  /** There has not been enough activity in this product yet for us to look
   * for anything at all. This is "we have not looked yet", not "we looked
   * and it was quiet". */
  "no_sessions_to_analyse",
]);
export type AnalysisOutcome = z.infer<typeof analysisOutcomeSchema>;

/**
 * Why did the run stop looking? Cap exhaustion must read as "we stopped
 * early", never as "there was nothing more to find" (SAC-10) — collapsing
 * the two would tell a customer their product is quieter than it is.
 */
export const analysisStopReasonSchema = z.enum([
  /** We checked everything there was to check this run; nothing cut it
   * short. */
  "ran_to_completion",
  /** We reached the limit on how many written explanations we can generate
   * for this project's first check, and stopped asking for more. Any
   * remaining candidates are still reported, just without one. */
  "cap_exhausted",
  /** An unexpected failure ended the run before it could finish checking
   * everything. */
  "fatal_error",
]);
export type AnalysisStopReason = z.infer<typeof analysisStopReasonSchema>;

/**
 * How was this finding's written summary produced? Six members, not five —
 * `floor_model_output_invalid` and `floor_model_text_rejected` are kept
 * distinct on purpose (D-10): "the model returned a shape we could not
 * parse" and "the model returned a parseable shape containing something it
 * may not assert" are different debugging signals, and collapsing them would
 * be the same defect as collapsing the two `analysis_outcome` zeros.
 *
 * Every `floor_*` member is an ABSENCE statement about the written
 * explanation, never a claim about the underlying finding — the finding's
 * own numbers are identical whichever member applies (SAC-6). Read
 * `packages/shared/src/gate/messages.ts:58-85` before editing one of these:
 * a sentence keyed by this member alone must not assert anything this
 * member's cause does not establish.
 */
export const summarySourceSchema = z.enum([
  /** The numbers plus a short written explanation, generated and checked for
   * this finding. */
  "model_rendered",
  /** The numbers on their own. No written-explanation capability is set up
   * for this installation. */
  "floor_no_key_configured",
  /** The numbers on their own. This project's first-check limit on written
   * explanations was already reached before this finding's turn came up. */
  "floor_cap_exhausted",
  /** The numbers on their own. We tried to generate a written explanation
   * and the attempt did not complete. */
  "floor_model_call_failed",
  /** The numbers on their own. What came back could not be read as a
   * written explanation at all. */
  "floor_model_output_invalid",
  /** The numbers on their own. A written explanation was generated but did
   * not pass our accuracy check, so we left it out rather than show
   * something that might overstate what we found. */
  "floor_model_text_rejected",
]);
export type SummarySource = z.infer<typeof summarySourceSchema>;

// ---------------------------------------------------------------------------
// The SummaryRenderer port's result shapes (D-1). Defined here, not in
// `packages/core`: `packages/adapters` (the producer) does not depend on
// `core` — its only workspace dependency is `@growthmind/shared` — so `core`
// is not reachable from the package that constructs these values. `worker`
// (the consumer) DOES depend on `@growthmind/adapters`, so the graph between
// them is one-way, not mutual. `shared` is the package both already depend
// on and which itself depends on nothing in the workspace (only `zod`), which
// is why the port's shapes live here rather than beside its implementation.
// ---------------------------------------------------------------------------

/**
 * Why a model render attempt failed, keyed by MECHANISM rather than by the
 * vendor's own error type:
 * - a schema-violating or unparsable result is `output_invalid`;
 * - everything else (transport, auth, rate limit, timeout) is `call_failed`.
 *
 * NOTHING MAPS ONTO THESE TWO MEMBERS YET.
 * `packages/adapters/src/anthropic/errors.ts` does not exist — no adapter and
 * no mapping ship in this sprint. That file WILL MAP every SDK error class
 * onto one of these two.
 *
 * INHERITED OBLIGATION, handed forward to whoever writes that adapter (D-13):
 * the vendor's own error text must NEVER surface verbatim on the failure arm
 * below. An Anthropic SDK error message can carry request-identifying detail,
 * and `message: z.string()` accepts it silently — the schema cannot enforce
 * this, so the adapter must, and it needs a test pinning it. This is a
 * requirement being handed forward, not a guarantee already met.
 */
export const summaryFailureCodeSchema = z.enum([
  /** The call completed but what came back could not be read as the
   * expected shape. */
  "output_invalid",
  /** The call itself did not complete — a transport, auth, or rate-limit
   * failure, or anything else that is not a shape problem. */
  "call_failed",
]);
export type SummaryFailureCode = z.infer<typeof summaryFailureCodeSchema>;

/**
 * Token counts as the SDK actually reports them (Wave 0 probe A-2): a field
 * the SDK did not report is `undefined`, NEVER coerced to `0` — a candidate
 * the model touched but did not meter would otherwise look identical to one
 * that cost nothing (FR-15b).
 */
export const summaryUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
});
export type SummaryUsage = z.infer<typeof summaryUsageSchema>;

/**
 * The port's return value. `resolvedModelId` and `usage` are present on
 * BOTH arms — a call that failed still consumed the cap and may still have
 * been metered. The run row that will record the model actually addressed
 * does not exist yet (see the run-table note at the top of this file); when
 * it is written, its `resolved_model_id` may be null only where no call was
 * attempted at all, never where one merely failed.
 */
export const summaryRenderResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    /** The model's short, plain-English restatement. Never a number, a class
     * name, or a confidence word (FR-8). The output schema that will enforce
     * that structurally — `packages/core/src/summary/output-schema.ts`, which
     * will declare `{ headline, context }` and no field for any of them — is
     * not written yet. Until it is, FR-8 rests on this comment alone. */
    headline: z.string(),
    context: z.string(),
    resolvedModelId: z.string(),
    usage: summaryUsageSchema,
  }),
  z.object({
    ok: z.literal(false),
    code: summaryFailureCodeSchema,
    /** Plain English. Never the vendor's own error text verbatim — the
     * inherited obligation named on `summaryFailureCodeSchema` above.
     * `z.string()` cannot enforce it; the adapter that produces this must. */
    message: z.string(),
    resolvedModelId: z.string(),
    usage: summaryUsageSchema,
  }),
]);
export type SummaryRenderResult = z.infer<typeof summaryRenderResultSchema>;
