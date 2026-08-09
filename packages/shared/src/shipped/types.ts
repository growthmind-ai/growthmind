export const SHIPPED_CHANGE_STATES = ["reported", "read_out", "closed", "abandoned"] as const;
export type ShippedChangeState = (typeof SHIPPED_CHANGE_STATES)[number];

export const SHIPPED_VERDICTS = ["keep", "kill", "leave", "no_verdict_given"] as const;
export type ShippedVerdict = (typeof SHIPPED_VERDICTS)[number];

// `never_asked` is what keeps `no_verdict_given` honest: a founder whose readout never reached
// them declined nothing, so their silence is recorded as a change we abandoned rather than as
// an answer they gave.
export const SHIPPED_ABANDONED_REASONS = ["project_gone", "never_asked"] as const;
export type ShippedAbandonedReason = (typeof SHIPPED_ABANDONED_REASONS)[number];

// What a report did to the change key. `already_answered` is the arm HC-2 left open: the key is
// fixed at (org, project, page, control), so a report landing after the readout can neither
// fork a row nor be given a date that has already passed.
export const SHIPPED_REPORT_CLAIMS = ["reported", "clock_unchanged", "already_answered"] as const;
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
