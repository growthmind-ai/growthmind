/**
 * THE TWO LIMITS ON WRITTEN EXPLANATIONS (O-011 FR-M6, ADD AD-2 and AD-23).
 *
 * TWO constants, in one file, so tuning a cost ceiling is an edit somebody can
 * find without code archaeology. They live in `worker/` deliberately and the
 * three places they do NOT live are each a decision:
 *
 *   - not `@growthmind/shared`, which is shapes both sides of a wire agree on,
 *     never policy;
 *   - not `@growthmind/adapters`, because a spend limit is a property of the
 *     lane that spends, not of the vendor it spends with — a second adapter
 *     must not arrive with a second cap;
 *   - not `@growthmind/db`, which takes BOTH ceilings as PARAMETERS on
 *     `claimModelCall` — `projectCap` and `organizationCap` on
 *     `ClaimModelCallInput` — precisely so no product decision is buried in a
 *     data-access layer.
 *
 * ── TWO CEILINGS, ONE STATEMENT (AD-23) ────────────────────────────────────
 * These are not two mechanisms. `createAnalysisRunsRepo.claimModelCall` is a
 * single conditional INSERT carrying one count subquery per ceiling as two
 * `AND` conjuncts, so a claim is refused when EITHER is spent while the claim
 * stays atomic with no check-then-write (D6). Both travel from here to that
 * statement through `AnalysisTickDeps` (`./tasks/analysis-tick.ts`), assembled
 * in `./index.ts`.
 *
 * ── BOTH REFUSALS READ AS THE SAME SENTENCE, AND THAT IS A DECISION ────────
 * `claimModelCall` answers `cap_exhausted` for either ceiling, the lane renders
 * `floor_cap_exhausted` for either, and that resolves to the one shipped
 * sentence: "This shows the numbers on their own. The limit on written
 * explanations for this product's first check was already reached."
 * (`SUMMARY_SOURCE_MESSAGES.floor_cap_exhausted`, `@growthmind/shared`.)
 *
 * BE HONEST ABOUT WHAT THAT MEANS. When the ORGANISATION ceiling is the one
 * that refused, that sentence names the wrong scope: it says "this product"
 * where the true cause is the whole account. The distinction between "this
 * product's limit" and "your account's limit" does not exist in the shipped
 * vocabulary, and this sprint authors no new customer-facing string (AD-23,
 * AD-26) — so the choice was between one imprecise sentence that has a home and
 * a second sentence that would have none. The imprecise one is still true in
 * what matters: there is no written explanation, a limit is why, and the
 * finding itself is unaffected. It is above all NOT SILENCE, which is the
 * failure SAC-10 exists to prevent. The heir is an account-scope sentence added
 * to the message table in `@growthmind/shared`, never a string authored here.
 *
 * ── A LIFETIME CEILING IS ALSO AN EXPOSURE, AND IT SHIPS UNWINDOWED ────────
 * NAMED HERE RATHER THAN LEFT FOR SOMEBODY TO DISCOVER. Both ceilings count
 * LIFETIME, NEVER-PRUNED rows (`packages/db/src/schema/analysis-model-calls.ts`,
 * "LIFETIME WINDOW"), and the claim mints one row per DISTINCT SIGNATURE. A
 * signature's inputs include the candidate's `surface` — a normalised URL path
 * derived from CUSTOMER TRAFFIC (`packages/core/src/findings/signature-tuple.ts`,
 * the D12 input table). So the count is driven, in part, by an input an
 * outsider can influence.
 *
 * THE ADVERSARIAL CASE, OUT LOUD. Someone who drives traffic to many distinct
 * URL paths that each clear the evidence gate mints a distinct signature per
 * path, and can therefore walk a tenant's claim count to either ceiling. Under
 * the organisation-wide one that is not confined to the project attacked: it
 * spends the budget of EVERY project the organisation owns. Because nothing
 * prunes the ledger and no window rolls, the exhaustion is PERMANENT and there
 * is no refund path a customer or an operator can take.
 *
 * WHAT IT COSTS AND WHAT IT DOES NOT. Spend stays bounded — that is exactly
 * what these ceilings are for, so this is not a cost attack. What is lost is
 * the FEATURE: written explanations denied for good. It degrades rather than
 * disappears — every candidate is still persisted with its numbers under
 * `floor_cap_exhausted` and the run still records `stop_reason = cap_exhausted`
 * — so it is a permanent downgrade to the floor, never silence.
 *
 * WHY IT IS NOT FIXED HERE. Windowing either ceiling would make the shipped
 * sentence above ("...for this product's first check...") false, and a true one
 * would be a NEW customer-facing string — which this sprint does not author
 * (AD-23, AD-26). The heir is the same heir the wrong-scope paragraph names: a
 * window, or an operator-facing reset, landed TOGETHER WITH its sentence in
 * `@growthmind/shared`'s message table. Until then this exposure is a known,
 * written-down property of the design and not an oversight.
 */

/**
 * THE PER-PROJECT LIMIT — twelve written explanations, for the lifetime of one
 * project's claim rows.
 *
 * ── THE WINDOW IS THE PROJECT'S FIRST CHECK, NOT A DAY ──────────────────────
 * The claim ledger `analysis_model_calls` is never pruned, so the count this
 * ceiling's subquery reads is a LIFETIME count of claim rows for
 * `(organization_id, project_id)`. That is what the already-shipped customer
 * sentence says, word for word — see the file header. A per-day or per-run
 * window would make that sentence false, and the sentence is the thing a
 * founder reads, so the window is chosen to match it rather than the other way
 * round.
 *
 * ── WHY TWELVE ─────────────────────────────────────────────────────────────
 * Enough that a first check reads as written up rather than sampled, and small
 * enough that a self-hoster's first bill is trivial. It is a judgement, not a
 * measurement, and it is deliberately cheap to revisit: changing the number is
 * an edit here, and changing the WINDOW is an edit to this ceiling's count
 * predicate in `createAnalysisRunsRepo.claimModelCall` — two places, both
 * named.
 *
 * ── TWELVE CLAIMS IS TWELVE BILLABLE REQUESTS ──────────────────────────────
 * The number below counts CLAIM ROWS, and a claim is only a true cost ceiling
 * if a claim can buy exactly one upstream request. It can: the adapter's
 * `MODEL_CALL_MAX_RETRIES` is `0`, stated at the `generateObject` call site in
 * `packages/adapters/src/anthropic/summariser.ts` rather than inherited, and
 * `packages/adapters/__tests__/anthropic/summariser.test.ts` A6 asserts a
 * retryable failure invokes the model exactly once. So the worst case a reader
 * has to compute is the number itself — no retry multiplier, no correction
 * factor. (Left unset, the AI SDK retries twice by default, which would have
 * made one claim worth up to three requests and this cap a 3× estimate.)
 *
 * THAT CONSTANT IS PACKAGE-INTERNAL, and this paragraph reasons about it from
 * outside. It is declared in `packages/adapters/src/anthropic/constants.ts` and
 * is NOT re-exported by the `@growthmind/adapters` barrel — which exports only
 * `DEFAULT_COLDSTART_MODEL` from that file — so the name above is a DEEP PATH a
 * reader opens, never something this file can import. Nothing here should add
 * that export merely to make the citation shorter: the arithmetic is a fact
 * about the adapter, and this file states it rather than depending on it.
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

/**
 * THE PER-ORGANISATION LIMIT — one hundred and twenty written explanations, for
 * the lifetime of one organisation's claim rows (AD-23).
 *
 * ── WHY A SECOND CEILING EXISTS AT ALL ─────────────────────────────────────
 * The per-project cap above is unbounded IN AGGREGATE. Nothing in this product
 * limits how many projects an organisation creates, so a ceiling of twelve per
 * project is really a ceiling of twelve × N with no N — an unbounded spend
 * surface sitting behind the one decision whose entire purpose is bounding
 * spend. This conjunct is what supplies the missing N.
 *
 * ── THE WINDOW IS THE SAME KIND OF WINDOW ──────────────────────────────────
 * A LIFETIME count of claim rows for `organization_id` alone — every project of
 * the organisation summed, over rows the lane never prunes. Deliberately the
 * same shape as the per-project window, so a reader has one rule to learn:
 * a claim row is spent budget forever, and deleting one would silently refund
 * budget a customer was already told was gone.
 *
 * ── WHY ONE HUNDRED AND TWENTY ─────────────────────────────────────────────
 * Ten projects' worth at the per-project ceiling: an organisation running a
 * realistic handful of products still never meets this limit, and an
 * organisation that creates projects in a loop meets it quickly. Like the
 * twelve above it is a judgement rather than a measurement, and the two numbers
 * are deliberately related — if the per-project cap moves, this one is
 * re-derived from it rather than tuned independently.
 *
 * ── IT REFUSES EXACTLY AS THE OTHER ONE DOES ───────────────────────────────
 * Same statement, same `cap_exhausted` answer, same `floor_cap_exhausted`
 * rendering, same `stop_reason = cap_exhausted` on the run. A project still
 * holding per-project budget is refused the moment its organisation runs out,
 * and every candidate past that point is still persisted with its numbers — the
 * exhaustion is a named state here too, never silence. What the customer reads
 * names the wrong scope, knowingly; the file header says why.
 */
export const ORG_MODEL_CALL_CAP = 120;
