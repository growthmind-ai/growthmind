import type {
  AnalysisOutcome,
  AnalysisRunStatus,
  AnalysisStopReason,
  SummarySource,
} from "./types";

export const ANALYSIS_RUN_STATUS_MESSAGES: Record<AnalysisRunStatus, string> = {
  running: "We are looking at what happened in your product right now.",
  completed: "We finished this check of your product.",
  failed:
    "Something went wrong partway through this check, and we could not finish it. We will try again on the next check.",
};

export const ANALYSIS_OUTCOME_MESSAGES: Record<AnalysisOutcome, string> = {
  produced_findings: "We found something in your product worth telling you about.",
  no_candidates_passed_gate:
    "We looked at what happened in your product, and nothing we saw was solid enough for us to report yet.",
  no_sessions_to_analyse:
    "There has not been enough activity in your product yet for us to look for anything.",
};

export const ANALYSIS_STOP_REASON_MESSAGES: Record<AnalysisStopReason, string> = {
  ran_to_completion: "We checked everything there was to check this time.",
  cap_exhausted:
    "We stopped early because we reached the limit on how many written explanations we can generate during your product's first check. Nothing found after that point was left out — it just did not get a written explanation.",
  fatal_error: "An unexpected problem ended this check before it could finish.",
};

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

type FloorFindingClass = "broken" | "confusing" | "changed_mind" | "instrumentation";

type FloorConfidenceBasis = "threshold_met" | "at_threshold" | "below_threshold";

type FloorCountRole = "reached_surface" | "left_without_continuing" | "affected_sessions";

export const FLOOR_OBSERVATION_TEMPLATES: Record<FloorFindingClass, string> = {
  broken: "Something people are doing on {surface} is not working.",

  confusing: "People are coming back to {surface} over and over.",

  changed_mind: "{surface} is being left without anything going wrong.",

  instrumentation: "One kind of activity we normally see on {surface} has almost stopped arriving.",
};

export const FLOOR_COUNT_TEMPLATES: Record<FloorCountRole, string> = {
  reached_surface: "{numerator} of {denominator} {unit} reached {surface}.",

  left_without_continuing:
    "{numerator} of {denominator} {unit} left {surface} without going anywhere it could have gone.",

  affected_sessions: "{numerator} of {denominator} {unit} were affected on {surface}.",
};

export const FLOOR_CONFIDENCE_TEMPLATES: Record<FloorConfidenceBasis, string> = {
  threshold_met: "The numbers behind this sit above the level we ask for before we say anything.",

  at_threshold:
    "The numbers behind this sit exactly at the level we ask for before we say anything, and no higher.",

  below_threshold: "The numbers behind this sit below the level we ask for before we say anything.",
};

export const FLOOR_TIMEFRAME_TEMPLATE: string =
  "This covers what happened between {windowStart} and {windowEnd}.";

export const FLOOR_NO_RATE_TEMPLATE: string =
  "Every session in this window was set aside, leaving no share to report.";

export const ALL_CUSTOMER_FACING_MESSAGES: readonly string[] = [
  ...Object.values(ANALYSIS_RUN_STATUS_MESSAGES),
  ...Object.values(ANALYSIS_OUTCOME_MESSAGES),
  ...Object.values(ANALYSIS_STOP_REASON_MESSAGES),
  ...Object.values(SUMMARY_SOURCE_MESSAGES),
  ...Object.values(FLOOR_OBSERVATION_TEMPLATES),
  ...Object.values(FLOOR_COUNT_TEMPLATES),
  ...Object.values(FLOOR_CONFIDENCE_TEMPLATES),
  FLOOR_TIMEFRAME_TEMPLATE,
  FLOOR_NO_RATE_TEMPLATE,
];
