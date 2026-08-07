// The backstop for a connection that alternates rather than stays broken: each failure
// there is a genuine edge, so the transition gate alone would not cap it. Ratified
// 2026-08-07.
export const SLACK_HEALTH_ALERT_COOLDOWN_SECONDS = 6 * 60 * 60;

export const ANALYSIS_HEALTH_ALERT_COOLDOWN_SECONDS = 6 * 60 * 60;

// How many consecutive terminal runs must all have failed before the org is told. Fewer
// alerts on a single bad run; more waits too long to be worth saying. Ratified 2026-08-07.
export const ANALYSIS_FAILING_RUN_COUNT = 3;
