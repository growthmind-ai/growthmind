/**
 * THE PER-PROJECT LIMIT ON WRITTEN EXPLANATIONS (O-011 FR-M6, ADD AD-2).
 *
 * ONE constant, in one file, so tuning the cost ceiling is an edit somebody can
 * find without code archaeology. It lives in `worker/` deliberately and the
 * three places it does NOT live are each a decision:
 *
 *   - not `@growthmind/shared`, which is shapes both sides of a wire agree on,
 *     never policy;
 *   - not `@growthmind/adapters`, because a spend limit is a property of the
 *     lane that spends, not of the vendor it spends with — a second adapter
 *     must not arrive with a second cap;
 *   - not `@growthmind/db`, which takes `cap` as a PARAMETER on
 *     `claimModelCall` precisely so no product decision is buried in a
 *     data-access layer.
 *
 * ── THE WINDOW IS THE PROJECT'S FIRST CHECK, NOT A DAY ──────────────────────
 * The claim ledger `analysis_model_calls` is never pruned, so the count the
 * cap predicate reads is a LIFETIME count of claim rows for
 * `(organization_id, project_id)`. That is what the already-shipped customer
 * sentence says, word for word: "The limit on written explanations for this
 * product's first check was already reached"
 * (`SUMMARY_SOURCE_MESSAGES.floor_cap_exhausted`). A per-day or per-run window
 * would make that sentence false, and the sentence is the thing a founder
 * reads — so the window is chosen to match it rather than the other way round.
 *
 * ── WHY TWELVE ─────────────────────────────────────────────────────────────
 * Enough that a first check reads as written up rather than sampled, and small
 * enough that a self-hoster's first bill is trivial. It is a judgement, not a
 * measurement, and it is deliberately cheap to revisit: changing the number is
 * an edit here, and changing the WINDOW is an edit to the count predicate in
 * `createAnalysisRunsRepo.claimModelCall` — two places, both named.
 *
 * ── TWELVE CLAIMS IS TWELVE BILLABLE REQUESTS ──────────────────────────────
 * The number below counts CLAIM ROWS, and a claim is only a true cost ceiling
 * if a claim can buy exactly one upstream request. It can:
 * `packages/adapters/src/anthropic/constants.ts:MODEL_CALL_MAX_RETRIES` is `0`,
 * stated at the `generateObject` call site rather than inherited, and
 * `packages/adapters/__tests__/anthropic/summariser.test.ts` A6 asserts a
 * retryable failure invokes the model exactly once. So the worst case a reader
 * has to compute is the number itself — no retry multiplier, no correction
 * factor. (Left unset, the AI SDK retries twice by default, which would have
 * made one claim worth up to three requests and this cap a 3× estimate.)
 *
 * The other half of the same arithmetic is time, not money:
 * `MODEL_REQUEST_TIMEOUT_MS` beside it bounds a single call, and the tick
 * renders candidates one at a time, so this cap also bounds how long a wholly
 * unresponsive upstream can hold a project's run row open.
 *
 * ── EXHAUSTION IS A NAMED STATE, NEVER SILENCE ─────────────────────────────
 * Reaching this limit does not drop candidates. Every candidate past it is
 * still persisted, under `floor_cap_exhausted`, and the run records
 * `stop_reason = cap_exhausted` — so "we stopped early" can never be read as
 * "there was nothing more to find" (SAC-10). That is enforced in
 * `./tasks/analysis-tick.ts` and pinned by W7/W8.
 */
export const COLDSTART_MODEL_CALL_CAP = 12;
