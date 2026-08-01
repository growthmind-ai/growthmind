// The one default model id in this codebase.
//
// Model selection is configuration, `GROWTHMIND_COLDSTART_MODEL` (declared in
// `packages/shared/src/env.ts`; cited by symbol, because a line number here was wrong
// the day it was written), validated-if-present. The default lives here, beside the
// adapter that speaks to the vendor, rather than in the env schema: `packages/shared`
// must not know which vendor this lane calls, and a default written into the env schema
// would silently become a second home for the same decision.
//
// Nothing may hardcode a model id at a call site. The composition root resolves
// `GROWTHMIND_COLDSTART_MODEL ?? DEFAULT_COLDSTART_MODEL` once, hands the resolved id
// to `createAnthropicSessionSummariser`, and that id lands on both arms of the port's
// result so a run row can always name the model addressed.
export const DEFAULT_COLDSTART_MODEL = "claude-sonnet-5";

/**
 * Per-call deadline on the model request.
 *
 * The same hazard `../slack/constants.ts:REQUEST_TIMEOUT_MS` and
 * `../posthog/constants.ts:REQUEST_TIMEOUT_MS` exist for, and it composes worse here:
 * an upstream that accepts the connection and never answers holds an open
 * `analysis_runs` row for this project, and a project with a running row is not picked
 * up again, so one hung socket is a permanent per-project jam, not a slow tick. The AI
 * SDK applies no deadline of its own; without this one the call inherits the runtime's,
 * which is effectively none.
 *
 * Why thirty seconds Longer than the Slack lane's ten because a model call is genuinely
 * slower than a small POST, and short because of what this call actually asks for: two
 * short sentences, a couple of hundred output tokens, non-streaming. Seconds is the
 * working range; thirty is headroom, not a target, so a merely slow model still lands
 * its answer rather than burning a cap claim for nothing.
 *
 * It is also chosen for how it composes.
 * `../../../../worker/src/tasks/analysis-tick.ts` renders candidates one at a time, so
 * the ceiling on how long a wholly unresponsive upstream can hold one project's run row
 * is `COLDSTART_MODEL_CALL_CAP × MODEL_REQUEST_TIMEOUT_MS`. Six minutes at today's
 * numbers. Bounded and self-clearing, which is the property that was missing, rather
 * than a number tuned to a benchmark.
 *
 * A fired deadline is not special-cased anywhere: it rejects the call, lands in
 * `./summariser.ts`'s single catch, and maps through `./errors.ts` to `call_failed`,
 * the same rung as any other transport failure, and the degradation ladder already
 * handles it.
 */
export const MODEL_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Retries on the model request, explicitly none.
 *
 * The AI sdk's `generateObject` defaults to `maxRetries: 2`, so an unset option means
 * one cap claim can issue three billable upstream requests, and does so precisely when
 * an account is rate-limited or 5xx-ing, the worst moment to triple the request rate.
 * `../../../../worker/src/analysis-cap.ts` calls its limit a hard per-project cap;
 * under the default that claim is off by 3×.
 *
 * Zero makes the cap's arithmetic true rather than approximate: one claim is at most
 * one upstream request, so `COLDSTART_MODEL_CALL_CAP` is simultaneously the ceiling on
 * claims and on billable requests, and a reader can compute the bill from one number.
 *
 * It also matches the precedent this package already set for its other network adapter,
 * `../slack/poster.ts`'s "no retry loop": a retryable failure is returned as
 * `call_failed` and the scheduler decides what happens next. Here the equivalent
 * decision is the lane's: a call that does not complete costs a written explanation,
 * never a finding, because the candidate is still persisted at the deterministic floor
 * with its numbers unaffected. Paying up to 3× the stated ceiling to occasionally
 * rescue prose that is optional by design is the wrong trade.
 */
export const MODEL_CALL_MAX_RETRIES = 0;

/**
 * The fence around candidate-derived data in the prompt.
 *
 * `SummariseInput.surface` is a normalised URL path taken from customer traffic, and
 * every other string on that input is derived from the same traffic. That is
 * attacker-influenceable data arriving in a model prompt. The worker's
 * `surfaceIsSafeToSend` gate (`../../../../worker/src/tasks/analysis-tick.ts`) guards
 * shape (normalisation, and no personal data) which is a different property entirely: a
 * perfectly normalised path is still a perfectly good injection vector.
 *
 * One token, both ends Open and close are the same string rather than a matched pair.
 * That is the point: there is exactly one sequence to strip out of a candidate value,
 * so there is no half of the fence a future edit can forget to remove. A pair would
 * double the surface and halve the guarantee.
 *
 * Why a candidate cannot close it Not because this string is hard to guess (it is
 * written down right here) but because `./summariser.ts`'s `delimitCandidateValue`
 * removes every occurrence of it from a value before wrapping, repeating until none
 * remains. Stripping to a fixpoint rather than in one pass is load-bearing: deleting an
 * inner occurrence can join its neighbours into a fresh one.
 *
 * The characters are chosen so no normalised URL path, symptom class, or unit could
 * ever produce it by accident, which keeps the stripping a no-op on every honest input.
 *
 * Fail direction is unchanged, and was already safe This is defence in depth, not a new
 * gate. Text that ignores the fence still has to satisfy the injected `z.strictObject`
 * output schema and then every `guardModelText` scanner, and any rejection lands the
 * candidate on the deterministic floor with its numbers untouched.
 */
export const CANDIDATE_DATA_DELIMITER = "<<<GROWTHMIND_CANDIDATE_DATA>>>";
