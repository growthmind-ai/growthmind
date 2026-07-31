// The one default model id in this codebase (AD-3).
//
// Model selection is CONFIGURATION — `GROWTHMIND_COLDSTART_MODEL`
// (`packages/shared/src/env.ts:39`), validated-if-present. The default lives
// here, beside the adapter that speaks to the vendor, rather than in the env
// schema: `packages/shared` must not know which vendor this lane calls, and a
// default written into the env schema would silently become a second home for
// the same decision.
//
// NOTHING may hardcode a model id at a call site. The composition root resolves
// `GROWTHMIND_COLDSTART_MODEL ?? DEFAULT_COLDSTART_MODEL` once, hands the
// resolved id to `createAnthropicSessionSummariser`, and that id lands on BOTH
// arms of the port's result so a run row can always name the model addressed.
export const DEFAULT_COLDSTART_MODEL = "claude-sonnet-5";

/**
 * PER-CALL DEADLINE ON THE MODEL REQUEST.
 *
 * The same H-1 hazard `../slack/constants.ts:REQUEST_TIMEOUT_MS` and
 * `../posthog/constants.ts:REQUEST_TIMEOUT_MS` exist for, and it composes worse
 * here: an upstream that accepts the connection and never answers holds an OPEN
 * `analysis_runs` row for this project, and a project with a running row is not
 * picked up again — so one hung socket is a permanent per-project jam, not a
 * slow tick. The AI SDK applies no deadline of its own; without this one the
 * call inherits the runtime's, which is effectively none.
 *
 * ── WHY THIRTY SECONDS ─────────────────────────────────────────────────────
 * Longer than the Slack lane's ten because a model call is genuinely slower
 * than a small POST, and short because of what this call actually asks for: two
 * short sentences, a couple of hundred output tokens, non-streaming. Seconds is
 * the working range; thirty is headroom, not a target, so a merely slow model
 * still lands its answer rather than burning a cap claim for nothing.
 *
 * It is also chosen for how it COMPOSES. `../../../worker/src/tasks/analysis-tick.ts`
 * renders candidates one at a time, so the ceiling on how long a wholly
 * unresponsive upstream can hold one project's run row is
 * `COLDSTART_MODEL_CALL_CAP × MODEL_REQUEST_TIMEOUT_MS` — six minutes at
 * today's numbers. Bounded and self-clearing, which is the property that was
 * missing, rather than a number tuned to a benchmark.
 *
 * A fired deadline is NOT special-cased anywhere: it rejects the call, lands in
 * `./summariser.ts`'s single catch, and maps through `./errors.ts` to
 * `call_failed` — the same rung as any other transport failure, and the
 * degradation ladder already handles it.
 */
export const MODEL_REQUEST_TIMEOUT_MS = 30_000;

/**
 * RETRIES ON THE MODEL REQUEST — EXPLICITLY NONE.
 *
 * The AI SDK's `generateObject` defaults to `maxRetries: 2`, so an unset option
 * means ONE cap claim can issue THREE billable upstream requests — and does so
 * precisely when an account is rate-limited or 5xx-ing, the worst moment to
 * triple the request rate. `../../../worker/src/analysis-cap.ts` calls its
 * limit a hard per-project cap; under the default that claim is off by 3×.
 *
 * Zero makes the cap's arithmetic true rather than approximate: one claim is at
 * most one upstream request, so `COLDSTART_MODEL_CALL_CAP` is simultaneously
 * the ceiling on claims AND on billable requests, and a reader can compute the
 * bill from one number.
 *
 * It also matches the precedent this package already set for its other network
 * adapter — `../slack/poster.ts`'s "NO RETRY LOOP": a retryable failure is
 * returned as `call_failed` and the SCHEDULER decides what happens next. Here
 * the equivalent decision is the lane's: a call that does not complete costs a
 * written explanation, never a finding, because the candidate is still
 * persisted at the deterministic floor with its numbers unaffected. Paying up
 * to 3× the stated ceiling to occasionally rescue prose that is optional by
 * design is the wrong trade.
 */
export const MODEL_CALL_MAX_RETRIES = 0;
