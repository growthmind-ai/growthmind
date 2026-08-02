import { GATE_REASON_MESSAGES } from "../gate/messages";
import type { ExclusionReason } from "../exclusions/types";
import type { ConnectRefusalCode, ConnectionStateStatus } from "./types";

export { GATE_REASON_MESSAGES };
export type { GateReasonKey } from "../gate/messages";

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

export const CONNECT_REFUSAL_MESSAGES: Record<ConnectRefusalCode, string> = {
  second_source:
    "This project is already attached to an analytics account. Detach that one first, then attach this one — we keep everything we already collected.",
  invalid_credentials:
    "That key did not work. Check you pasted your personal key rather than the project key, and that it is allowed to read events.",
  // Never "check the project number" — discovered from the key now, not typed: no field to check.
  project_not_found:
    "The key works, but it reaches no project we can read — either it has access to none, or the one it reached before is gone. Check what this key is allowed to read in your analytics account, then try again.",
  unreachable:
    "We could not reach that address. Check the region address, confirm it is reachable from this machine, then try again.",

  rate_limited:
    "Your analytics account asked us to slow down, so we stopped this check early. We will pick up where we left off on the next one — nothing already collected is lost.",
  misconfigured:
    "This installation cannot store an outside key safely yet. Set GROWTHMIND_ENCRYPTION_KEY to a real value (openssl rand -base64 32), restart, then try again.",
};

export function secondSourceRefusalMessage(existing: {
  host: string;
  sourceProjectId: string;
}): string {
  return `This project is already attached to project ${existing.sourceProjectId} at ${existing.host}. Detach that one first, then attach this one — we keep everything we already collected.`;
}

export const EXCLUSION_REASON_LABELS: Record<ExclusionReason, string> = {
  none: "Kept and counted",
  internal_domain: "Your own team",
  automation_headless: "Automated browser tests",
  automation_known_agent: "Crawlers, monitors and scripts",
  automation_coding_agent: "Coding agents",
};

export const COUNTER_LABELS = {
  totalReceived: "Everything we have seen",
  kept: "Counted as real people",
  setAside: "Set aside",
  keptIdentityUnverified: "Counted, but we could not check who they were",
  droppedUnreadable: "Could not be read",
  asOf: "As of",
} as const;

export const COUNTER_WINDOW_STATEMENT =
  "Counted since you attached this project. This is not a rolling window.";

export const COUNTER_COMPLETENESS_STATEMENT =
  "This is what we have seen so far. Events that arrive late, or from a device whose clock is behind, can take longer to show up.";

export const SOURCE_ABSENT_NOTICE =
  "Nothing is attached to this project, so there is nothing to count yet.";

export const SOURCE_DEGRADED_NOTICE =
  "The last check did not finish, so these numbers may be behind what your product has recorded.";

function describeDurationEnglish(seconds: number): string {
  if (seconds < 90) {
    return `${Math.max(1, Math.round(seconds))} seconds`;
  }
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes === 1 ? "about a minute" : `about ${minutes} minutes`;
}

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

export const ALL_CUSTOMER_FACING_MESSAGES: readonly string[] = [
  ...Object.values(CONNECTION_STATE_MESSAGES),
  ...Object.values(CONNECT_REFUSAL_MESSAGES),
  ...Object.values(EXCLUSION_REASON_LABELS),
  ...Object.values(COUNTER_LABELS),

  ...Object.values(GATE_REASON_MESSAGES),
  COUNTER_WINDOW_STATEMENT,
  COUNTER_COMPLETENESS_STATEMENT,
  SOURCE_ABSENT_NOTICE,
  SOURCE_DEGRADED_NOTICE,
];
