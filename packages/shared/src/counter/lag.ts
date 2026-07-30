// Expected-lag description for the onboarding counter (O-003 FR-15).
//
// TYPED STUB (O-003 scaffold): the constants are real; the body throws.
import type { ExpectedLag } from "./types";

/**
 * Decision 0001 measured the events-leg p90 retrieval lag at roughly 25
 * seconds. Addendum A ROW 5 CORRECTS how that number should be read: the
 * throttling that made it look inflated was on the session-recordings leg,
 * not this one (the events list absorbed 600 rapid requests with zero
 * throttling), so this is a REAL measurement, not a ceiling a politer poller
 * would beat.
 */
export const POSTHOG_P90_RETRIEVAL_SECONDS = 25;

/** The slowest custom-event retrieval decision 0001 observed, rounded up.
 * Used for the worst case rather than an invented multiple. */
export const POSTHOG_MAX_RETRIEVAL_SECONDS = 220;

/**
 * `typicalSeconds = pollIntervalSeconds + POSTHOG_P90_RETRIEVAL_SECONDS`
 * `worstCaseSeconds = pollIntervalSeconds + POSTHOG_MAX_RETRIEVAL_SECONDS`
 *
 * `statement` comes from `session-source/messages.ts` — one home for copy.
 * It states what we have measured and never claims freshness we cannot
 * deliver: no overlap window makes a poll on client-declared event time
 * complete (D-6f).
 */
export function describeExpectedLag(_input: { pollIntervalSeconds: number }): ExpectedLag {
  throw new Error("TYPED STUB (O-003 scaffold): describeExpectedLag");
}
