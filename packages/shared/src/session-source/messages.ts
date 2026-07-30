// EVERY customer-facing string this sprint produces lives here (O-003 D-13).
//
// One home, for three reasons. (a) The plain-English audit and the "live"
// grep become a single-file review instead of a repo sweep. (b) O-008
// IMPORTS these rather than re-authoring them, so there is no wire between a
// producer and a consumer to sever (D11). (c) The honesty rule from D-6f is
// enforceable: the word "live" appears in no string this sprint produces,
// because no overlap window can make a poll on client-declared event time
// complete, and we do not claim otherwise.
//
// House rules these strings obey, each asserted by a named test:
//   - no "live" as a freshness claim;
//   - no product jargon and no bare HTTP status number;
//   - every connection state and every connect refusal reads distinctly, so
//     a screen can never show two situations the same way;
//   - the vendor's name never appears — the pipeline behind the port does not
//     learn it, and neither does the customer-facing copy.
import type { ExclusionReason } from "../exclusions/types";
import type { ConnectRefusalCode, ConnectionStateStatus } from "./types";

/** The seven states O-008 renders. Pairwise distinct by construction. */
export const CONNECTION_STATE_MESSAGES: Record<ConnectionStateStatus, string> = {
  not_connected:
    "No analytics account is attached to this project yet. Attach one to start seeing what people do in your product.",
  validating: "We are checking the key you gave us. This usually takes a few seconds.",
  connected_never_polled:
    "Attached. We have not fetched anything yet — the first check runs within a minute.",
  connected_no_events_yet:
    "Attached, and we checked. Nothing has come through yet, which is what a quiet product looks like.",
  connected_receiving: "Attached, and events are coming through.",
  failing:
    "We could not reach your analytics account on the last try. The reason is below, with what to change.",
  disconnected:
    "This project is no longer attached. Everything we already collected is still here.",
};

/** Why a connect attempt was refused. Each names the one thing to fix. */
export const CONNECT_REFUSAL_MESSAGES: Record<ConnectRefusalCode, string> = {
  second_source:
    "This project is already attached to an analytics account. Detach that one first, then attach this one — we keep everything we already collected.",
  invalid_credentials:
    "That key did not work. Check you pasted your personal key rather than the project key, and that it is allowed to read events.",
  project_not_found:
    "The key worked, but we could not find that project. Check the project number in your analytics settings.",
  unreachable:
    "We could not reach that address. Check the region address, confirm it is reachable from this machine, then try again.",
  misconfigured:
    "This installation cannot store an outside key safely yet. Set GROWTHMIND_ENCRYPTION_KEY to a real value (openssl rand -base64 32), restart, then try again.",
};

/**
 * The second-source refusal with the existing attachment named, so the
 * customer knows exactly which one to detach — the cutover path in one
 * sentence rather than a support ticket.
 */
export function secondSourceRefusalMessage(existing: {
  host: string;
  sourceProjectId: string;
}): string {
  return `This project is already attached to project ${existing.sourceProjectId} at ${existing.host}. Detach that one first, then attach this one — we keep everything we already collected.`;
}

/** Labels for the counter's set-aside breakdown, in the customer's terms. */
export const EXCLUSION_REASON_LABELS: Record<ExclusionReason, string> = {
  none: "Kept and counted",
  internal_domain: "Your own team",
  automation_headless: "Automated browser tests",
  automation_known_agent: "Crawlers, monitors and scripts",
  automation_coding_agent: "Coding agents",
};

/** Labels for the onboarding counter's own numbers. */
export const COUNTER_LABELS = {
  totalReceived: "Everything we have seen",
  kept: "Counted as real people",
  setAside: "Set aside",
  keptIdentityUnverified: "Counted, but we could not check who they were",
  droppedUnreadable: "Could not be read",
  asOf: "As of",
} as const;

/**
 * The window statement. Named explicitly rather than implied — a count with
 * an unstated window is a count nobody can act on.
 */
export const COUNTER_WINDOW_STATEMENT =
  "Counted since you attached this project. This is not a rolling window.";

/**
 * The honesty statement (D-6f). PostHog stores the time the customer's own
 * browser declared, and exposes no arrival time by any route, so an event
 * that arrives late or from a device with a slow clock can land behind
 * everything we have already read. We say what we have seen; we never claim
 * to have seen everything.
 */
export const COUNTER_COMPLETENESS_STATEMENT =
  "This is what we have seen so far. Events that arrive late, or from a device whose clock is behind, can take longer to show up.";

/** Shown when a project has no attachment at all — distinct from a zero
 * count, which means we looked and found nothing. */
export const SOURCE_ABSENT_NOTICE =
  "Nothing is attached to this project, so there is nothing to count yet.";

/** Shown when the last check failed but earlier numbers are still on screen,
 * so a stale number is never presented as a current one. */
export const SOURCE_DEGRADED_NOTICE =
  "The last check did not finish, so these numbers may be behind what your product has recorded.";

/**
 * Plain-English duration. Switches to minutes before the number gets big
 * enough to read like a code rather than a length of time.
 */
function describeDurationEnglish(seconds: number): string {
  if (seconds < 90) {
    return `${Math.max(1, Math.round(seconds))} seconds`;
  }
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes === 1 ? "about a minute" : `about ${minutes} minutes`;
}

/**
 * The freshness sentence attached to the counter. States a MEASUREMENT, never
 * a promise, and never the word this file exists to keep out.
 */
export function expectedLagStatement(input: {
  typicalSeconds: number;
  worstCaseSeconds: number;
}): string {
  return `Most of the time a new event shows up within ${describeDurationEnglish(
    input.typicalSeconds,
  )}. Sometimes it takes ${describeDurationEnglish(
    input.worstCaseSeconds,
  )}. That is what we have measured, not a promise.`;
}

/**
 * Every fixed customer-facing string in this module, in one array, so the
 * plain-English audit is TOTAL rather than best-effort: a new constant that
 * is not added here is caught by the audit's own completeness check instead
 * of quietly escaping review.
 */
export const ALL_CUSTOMER_FACING_MESSAGES: readonly string[] = [
  ...Object.values(CONNECTION_STATE_MESSAGES),
  ...Object.values(CONNECT_REFUSAL_MESSAGES),
  ...Object.values(EXCLUSION_REASON_LABELS),
  ...Object.values(COUNTER_LABELS),
  COUNTER_WINDOW_STATEMENT,
  COUNTER_COMPLETENESS_STATEMENT,
  SOURCE_ABSENT_NOTICE,
  SOURCE_DEGRADED_NOTICE,
];
