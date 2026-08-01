// Expected-lag description for the onboarding counter.
//
// Implemented in Wave 1 against the scaffold's final signature.
import { expectedLagStatement } from "../session-source/messages";
import type { ExpectedLag } from "./types";

/**
 * Decision 0001 measured the events-leg p90 retrieval lag at roughly 25 seconds.
 * Addendum a row 5 corrects how that number should be read: the throttling that made it
 * look inflated was on the session-recordings leg, not this one (the events list
 * absorbed 600 rapid requests with zero throttling), so this is a real measurement, not
 * a ceiling a politer poller would beat.
 */
export const POSTHOG_P90_RETRIEVAL_SECONDS = 25;

/** The slowest custom-event retrieval decision 0001 observed, rounded up. Used for the
 * worst case rather than an invented multiple. */
export const POSTHOG_MAX_RETRIEVAL_SECONDS = 220;

/**
 * `typicalSeconds = pollIntervalSeconds + POSTHOG_P90_RETRIEVAL_SECONDS`
 * `worstCaseSeconds = pollIntervalSeconds + POSTHOG_MAX_RETRIEVAL_SECONDS`
 *
 * `statement` comes from `session-source/messages.ts`, one home for copy. It states
 * what we have measured and never claims freshness we cannot deliver: no overlap window
 * makes a poll on client-declared event time complete.
 */
export function describeExpectedLag(input: { pollIntervalSeconds: number }): ExpectedLag {
  // Both figures are computed from the connection's own cadence rather than hardcoded,
  // so changing `poll_interval_seconds` on one connection changes what that customer is
  // told. The number and the copy cannot drift apart.
  const pollIntervalSeconds = Math.max(0, Math.round(input.pollIntervalSeconds));
  const typicalSeconds = pollIntervalSeconds + POSTHOG_P90_RETRIEVAL_SECONDS;
  const worstCaseSeconds = pollIntervalSeconds + POSTHOG_MAX_RETRIEVAL_SECONDS;

  return {
    typicalSeconds,
    worstCaseSeconds,
    // One home for copy. Building the sentence here would put a customer-facing string
    // outside the file the plain-English audit reads.
    statement: expectedLagStatement({ typicalSeconds, worstCaseSeconds }),
  };
}
