/**
 * The two limits on written explanations.
 *
 * Two constants, in one file, so tuning a cost ceiling is an edit somebody can find
 * without code archaeology. They live in `worker/` deliberately and the three places
 * they do not live are each a decision:
 *
 * Not `@growthmind/shared`, which is shapes both sides of a wire agree on,
 *  never policy;
 * Not `@growthmind/adapters`, because a spend limit is a property of the
 *  lane that spends, not of the vendor it spends with — a second adapter
 *  must not arrive with a second cap;
 * Not `@growthmind/db`, which takes both ceilings as parameters on
 *  `claimModelCall` — `projectCap` and `organizationCap` on
 *  `ClaimModelCallInput` — precisely so no product decision is buried in a
 *  data-access layer.
 *
 * Two ceilings, one statement These are not two mechanisms.
 * `createAnalysisRunsRepo.claimModelCall` is a single conditional insert carrying one
 * count subquery per ceiling as two `AND` conjuncts, so a claim is refused when either
 * is spent while the claim stays atomic with no check-then-write. Both travel from here
 * to that statement through `AnalysisTickDeps` (`./tasks/analysis-tick.ts`), assembled
 * in `./index.ts`.
 *
 * Both refusals read as the same sentence, and that is a decision `claimModelCall`
 * answers `cap_exhausted` for either ceiling, the lane renders `floor_cap_exhausted`
 * for either, and that resolves to the one shipped sentence: "This shows the numbers on
 * their own. The limit on written explanations for this product's first check was
 * already reached." (`SUMMARY_SOURCE_MESSAGES.floor_cap_exhausted`,
 * `@growthmind/shared`.)
 *
 * Be honest about what that means. When the organisation ceiling is the one that
 * refused, that sentence names the wrong scope: it says "this product" where the true
 * cause is the whole account. The distinction between "this product's limit" and "your
 * account's limit" does not exist in the shipped vocabulary, and this sprint authors no
 * new customer-facing string, so the choice was between one imprecise sentence that has
 * a home and a second sentence that would have none. The imprecise one is still true in
 * what matters: there is no written explanation, a limit is why, and the finding itself
 * is unaffected. It is above all not silence, which is the failure SAC-10 exists to
 * prevent. The heir is an account-scope sentence added to the message table in
 * `@growthmind/shared`, never a string authored here.
 *
 * A lifetime ceiling is also an exposure, and it ships unwindowed named here rather
 * than left for somebody to discover. Both ceilings count lifetime, never-pruned rows
 * (`packages/db/src/schema/analysis-model-calls.ts`, "lifetime window"), and the claim
 * mints one row per distinct signature. A signature's inputs include the candidate's
 * `surface`. A normalised URL path derived from customer traffic
 * (`packages/core/src/findings/signature-tuple.ts`, the input table). So the count is
 * driven, in part, by an input an outsider can influence.
 *
 * The adversarial case, out loud. Someone who drives traffic to many distinct URL paths
 * that each clear the evidence gate mints a distinct signature per path, and can
 * therefore walk a tenant's claim count to either ceiling. Under the organisation-wide
 * one that is not confined to the project attacked: it spends the budget of every
 * project the organisation owns. Because nothing prunes the ledger and no window rolls,
 * the exhaustion is permanent and there is no refund path a customer or an operator can
 * take.
 *
 * What it costs and what it does not. Spend stays bounded, that is exactly what these
 * ceilings are for, so this is not a cost attack. What is lost is the feature: written
 * explanations denied for good. It degrades rather than disappears. Every candidate is
 * still persisted with its numbers under `floor_cap_exhausted` and the run still
 * records `stop_reason = cap_exhausted`, so it is a permanent downgrade to the floor,
 * never silence.
 *
 * Why it is not fixed here. Windowing either ceiling would make the shipped sentence
 * above ("..for this product's first check..") false, and a true one would be a new
 * customer-facing string, which this sprint does not author. The heir is the same heir
 * the wrong-scope paragraph names: a window, or an operator-facing reset, landed
 * together with its sentence in `@growthmind/shared`'s message table. Until then this
 * exposure is a known, written-down property of the design and not an oversight.
 */

/**
 * The per-project limit, twelve written explanations, for the lifetime of one project's
 * claim rows.
 *
 * The window is the project's first check, not a day The claim ledger
 * `analysis_model_calls` is never pruned, so the count this ceiling's subquery reads is
 * a lifetime count of claim rows for `(organization_id, project_id)`. That is what the
 * already-shipped customer sentence says, word for word. See the file header. A per-day
 * or per-run window would make that sentence false, and the sentence is the thing a
 * founder reads, so the window is chosen to match it rather than the other way round.
 *
 * Why twelve Enough that a first check reads as written up rather than sampled, and
 * small enough that a self-hoster's first bill is trivial. It is a judgement, not a
 * measurement, and it is deliberately cheap to revisit: changing the number is an edit
 * here, and changing the window is an edit to this ceiling's count predicate in
 * `createAnalysisRunsRepo.claimModelCall`, two places, both named.
 *
 * Twelve claims is twelve billable requests The number below counts claim rows, and a
 * claim is only a true cost ceiling if a claim can buy exactly one upstream request. It
 * can: the adapter's `MODEL_CALL_MAX_RETRIES` is `0`, stated at the `generateObject`
 * call site in `packages/adapters/src/anthropic/summariser.ts` rather than inherited,
 * and `packages/adapters/__tests__/anthropic/summariser.test.ts` A6 asserts a retryable
 * failure invokes the model exactly once. So the worst case a reader has to compute is
 * the number itself. No retry multiplier, no correction factor. (Left unset, the AI SDK
 * retries twice by default, which would have made one claim worth up to three requests
 * and this cap a 3× estimate.)
 *
 * That constant is package-internal, and this paragraph reasons about it from outside.
 * It is declared in `packages/adapters/src/anthropic/constants.ts` and is not
 * re-exported by the `@growthmind/adapters` barrel, which exports only
 * `DEFAULT_COLDSTART_MODEL` from that file, so the name above is a deep path a reader
 * opens, never something this file can import. Nothing here should add that export
 * merely to make the citation shorter: the arithmetic is a fact about the adapter, and
 * this file states it rather than depending on it.
 *
 * The other half of the same arithmetic is time, not money: `MODEL_REQUEST_TIMEOUT_MS`
 * beside it bounds a single call, and the tick renders candidates one at a time, so
 * this cap also bounds how long a wholly unresponsive upstream can hold a project's run
 * row open.
 *
 * Exhaustion is a named state, never silence Reaching this limit does not drop
 * candidates. Every candidate past it is still persisted, under `floor_cap_exhausted`,
 * and the run records `stop_reason = cap_exhausted`, so "we stopped early" can never be
 * read as "there was nothing more to find" (SAC-10). That is enforced in
 * `./tasks/analysis-tick.ts` and pinned by W7/W8.
 */
export const COLDSTART_MODEL_CALL_CAP = 12;

/**
 * The per-organisation limit, one hundred and twenty written explanations, for the
 * lifetime of one organisation's claim rows.
 *
 * Why a second ceiling exists at all The per-project cap above is unbounded in
 * aggregate. Nothing in this product limits how many projects an organisation creates,
 * so a ceiling of twelve per project is really a ceiling of twelve × N with no N. An
 * unbounded spend surface sitting behind the one decision whose entire purpose is
 * bounding spend. This conjunct is what supplies the missing N.
 *
 * The window is the same kind of window a lifetime count of claim rows for
 * `organization_id` alone. Every project of the organisation summed, over rows the lane
 * never prunes. Deliberately the same shape as the per-project window, so a reader has
 * one rule to learn: a claim row is spent budget forever, and deleting one would
 * silently refund budget a customer was already told was gone.
 *
 * Why one hundred and twenty Ten projects' worth at the per-project ceiling: an
 * organisation running a realistic handful of products still never meets this limit,
 * and an organisation that creates projects in a loop meets it quickly. Like the twelve
 * above it is a judgement rather than a measurement, and the two numbers are
 * deliberately related. If the per-project cap moves, this one is re-derived from it
 * rather than tuned independently.
 *
 * It refuses exactly as the other one does Same statement, same `cap_exhausted` answer,
 * same `floor_cap_exhausted` rendering, same `stop_reason = cap_exhausted` on the run.
 * A project still holding per-project budget is refused the moment its organisation
 * runs out, and every candidate past that point is still persisted with its numbers.
 * The exhaustion is a named state here too, never silence. What the customer reads
 * names the wrong scope, knowingly; the file header says why.
 */
export const ORG_MODEL_CALL_CAP = 120;
