export const GET_IT_FIXED_ACTION_ID = "growthmind.get_it_fixed.v1";

export const FINDING_BLOCK_ID_PREFIX = "growthmind.finding.v1:";

export const SLACK_INTERACTION_ACTOR = "slack:interaction";

export const SLACK_INTERACTION_ROLE = "slack_interaction";

export const SLACK_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

export const FIX_RESULTS_WINDOW_DAYS = 14;

export const FIX_RESULTS_RULE_VERSION = 1;

// The columns the fix's identity is keyed on, named here so the unique index, the
// conflict target and the tests that assert stability all read one list.
export const FIX_CONFLICT_TARGET = ["organization_id", "finding_id"] as const;

export type FixConflictColumn = (typeof FIX_CONFLICT_TARGET)[number];
