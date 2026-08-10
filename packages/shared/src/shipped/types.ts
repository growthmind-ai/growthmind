export const SHIPPED_CHANGE_STATES = ["reported", "read_out", "closed", "abandoned"] as const;
export type ShippedChangeState = (typeof SHIPPED_CHANGE_STATES)[number];

export const SHIPPED_VERDICTS = ["keep", "kill", "leave", "no_verdict_given"] as const;
export type ShippedVerdict = (typeof SHIPPED_VERDICTS)[number];

// `never_asked` is what keeps `no_verdict_given` honest: a founder whose readout never reached
// them declined nothing, so their silence is recorded as a change we abandoned rather than as
// an answer they gave.
export const SHIPPED_ABANDONED_REASONS = ["project_gone", "never_asked"] as const;
export type ShippedAbandonedReason = (typeof SHIPPED_ABANDONED_REASONS)[number];

// A verdict pressed on a change we failed to measure is a different fact from one pressed on a
// change we measured, so the branch the readout took is stored beside the answer.
export const SHIPPED_UNMEASURED_OUTCOMES = [
  "too_few",
  "stale_page_spelling",
  "corpus_predates_who_counts",
] as const;

export const SHIPPED_READOUT_OUTCOMES = ["measured", ...SHIPPED_UNMEASURED_OUTCOMES] as const;
export type ShippedReadoutOutcome = (typeof SHIPPED_READOUT_OUTCOMES)[number];

// What a report did to the change key, which is fixed at (org, project, page, control) and is
// never forked here. `watching_again` is the one arm that moves the clock: a readout that
// measured nothing answered nothing, so the same row takes a fresh date. `stopped_watching` is
// the arm that answered nothing and cannot be put back on a clock either.
export const SHIPPED_REPORT_CLAIMS = [
  "reported",
  "clock_unchanged",
  "watching_again",
  "already_answered",
  "stopped_watching",
] as const;
export type ShippedReportClaim = (typeof SHIPPED_REPORT_CLAIMS)[number];

// Derived from the control label at report time and never taken from the caller: a whole
// page is answered off the event spine, a control only off the sessions that were recorded.
export const SHIPPED_CORPUS_KINDS = ["page", "recorded"] as const;
export type ShippedCorpusKind = (typeof SHIPPED_CORPUS_KINDS)[number];

export const SHIPPED_LEAD_COUNTS = ["reach", "repeat"] as const;
export type ShippedLeadCount = (typeof SHIPPED_LEAD_COUNTS)[number];

export const SHIPPED_CHANGE_CONFLICT_TARGET = [
  "organization_id",
  "project_id",
  "page",
  "control_label",
] as const;
export type ShippedChangeKeyColumn = (typeof SHIPPED_CHANGE_CONFLICT_TARGET)[number];

// Postgres treats NULLs as distinct in a unique index, so a nullable label would let every
// page-level re-report insert a second row and start a second clock.
export const NO_CONTROL_LABEL = "";

// Chosen by Tom: see .ai/decisions/0027-o-053-report-shipped-human-calls.md
export const VERDICT_WINDOW_DAYS_DEFAULT = 7;

export const SHIPPED_READOUT_TASK = "shipped:readout-tick";
