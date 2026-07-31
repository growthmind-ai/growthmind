// EVERY customer-facing string this lane produces lives here (O-005 D-10,
// following O-003 D-13's one-home rule at
// `packages/shared/src/session-source/messages.ts:1-24`). One home means the
// plain-English audit below is a single-file review instead of a repo sweep,
// and a future consumer (O-007's Slack renderer) imports these rather than
// re-authoring them — no wire between a producer and a consumer to sever
// (D11).
//
// House rules these strings obey, each asserted by a named test below:
//   - no product jargon and no bare HTTP status number;
//   - every `analysis_run_status` / `analysis_outcome` / `analysis_stop_reason`
//     / `summary_source` member reads distinctly, so a screen can never show
//     two situations the same way (FR-18b);
//   - `no_sessions_to_analyse` and `no_candidates_passed_gate` read as two
//     different answers to the same zero (FR-18d);
//   - every `summary_source` sentence keyed `floor_*` is an ABSENCE
//     statement about the written explanation only — it never asserts
//     anything about the underlying finding, which is unchanged whichever
//     member applies. Read `packages/shared/src/gate/messages.ts:58-85`
//     before touching one of these: the previous incident there is exactly
//     the shape a positive-observation phrasing here would repeat (SAC-6).
import type {
  AnalysisOutcome,
  AnalysisRunStatus,
  AnalysisStopReason,
  SummarySource,
} from "./types";

/** The three states a customer (or a support screen) can see a run in. */
export const ANALYSIS_RUN_STATUS_MESSAGES: Record<AnalysisRunStatus, string> = {
  running: "We are looking at what happened in your product right now.",
  completed: "We finished this check of your product.",
  failed:
    "Something went wrong partway through this check, and we could not finish it. We will try again on the next check.",
};

/**
 * What a completed run found. `no_sessions_to_analyse` and
 * `no_candidates_passed_gate` are kept distinct on purpose (FR-18d) — "we
 * have not looked yet" and "we looked and your product was quiet" are
 * different answers to the same zero.
 */
export const ANALYSIS_OUTCOME_MESSAGES: Record<AnalysisOutcome, string> = {
  produced_findings: "We found something in your product worth telling you about.",
  no_candidates_passed_gate:
    "We looked at what happened in your product, and nothing we saw was solid enough for us to report yet.",
  no_sessions_to_analyse:
    "There has not been enough activity in your product yet for us to look for anything.",
};

/** Why a run stopped looking. `cap_exhausted` must never read as "nothing
 * left to find" (SAC-10) — it is a stated limit, not an empty product. */
export const ANALYSIS_STOP_REASON_MESSAGES: Record<AnalysisStopReason, string> = {
  ran_to_completion: "We checked everything there was to check this time.",
  cap_exhausted:
    "We stopped early because we reached the limit on how many written explanations we can generate during your product's first check. Nothing found after that point was left out — it just did not get a written explanation.",
  fatal_error: "An unexpected problem ended this check before it could finish.",
};

/**
 * How a finding's written summary was produced. Every `floor_*` sentence
 * states only that a written explanation is missing and why — never a claim
 * about the finding itself, which is identical whichever member applies.
 */
export const SUMMARY_SOURCE_MESSAGES: Record<SummarySource, string> = {
  model_rendered: "This includes a short written explanation alongside the numbers.",
  floor_no_key_configured:
    "This shows the numbers on their own. Written explanations are not set up for this installation yet.",
  floor_cap_exhausted:
    "This shows the numbers on their own. The limit on written explanations for this product's first check was already reached.",
  floor_model_call_failed:
    "This shows the numbers on their own. An attempt to add a written explanation did not complete.",
  floor_model_output_invalid:
    "This shows the numbers on their own. What came back could not be read as a written explanation.",
  floor_model_text_rejected:
    "This shows the numbers on their own. A written explanation was generated but did not pass our accuracy check, so we left it out.",
};

/**
 * Every fixed customer-facing string this lane produces, in one array, so
 * the plain-English audit below is TOTAL rather than best-effort: a new
 * constant that is not added here is caught by the completeness test
 * instead of quietly escaping review.
 */
export const ALL_CUSTOMER_FACING_MESSAGES: readonly string[] = [
  ...Object.values(ANALYSIS_RUN_STATUS_MESSAGES),
  ...Object.values(ANALYSIS_OUTCOME_MESSAGES),
  ...Object.values(ANALYSIS_STOP_REASON_MESSAGES),
  ...Object.values(SUMMARY_SOURCE_MESSAGES),
];
