import type { EventsSeenCounter } from "../counter/types";
import {
  LANDING_LIVENESS_DISCONNECTED,
  LANDING_LIVENESS_FAILING,
  LANDING_LIVENESS_FIRST_CHECK_PENDING,
  LANDING_LIVENESS_NOT_CONNECTED,
  LANDING_LIVENESS_NOTHING_YET_TEMPLATE,
  LANDING_LIVENESS_RECEIVING_TEMPLATE,
  LANDING_LIVENESS_VALIDATING,
  SINCE_MOMENTS_AGO,
  SINCE_TEMPLATE,
  SINCE_UNIT_LABELS,
} from "./messages";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function countedPhrase(count: number, unit: string): string {
  return SINCE_TEMPLATE.replaceAll("{count}", String(count)).replaceAll(
    "{unit}",
    count === 1 ? unit : `${unit}s`,
  );
}

// Clamped at zero so a clock ahead of the server reads as the present rather
// than a negative age.
export function describeSince(when: Date, nowMs: number): string {
  const elapsed = Math.max(0, nowMs - when.getTime());

  if (elapsed < MINUTE_MS) return SINCE_MOMENTS_AGO;

  if (elapsed < HOUR_MS) {
    return countedPhrase(Math.floor(elapsed / MINUTE_MS), SINCE_UNIT_LABELS.minute);
  }

  if (elapsed < DAY_MS) {
    return countedPhrase(Math.floor(elapsed / HOUR_MS), SINCE_UNIT_LABELS.hour);
  }

  return countedPhrase(Math.floor(elapsed / DAY_MS), SINCE_UNIT_LABELS.day);
}

export interface LandingLivenessInput {
  readonly counter: EventsSeenCounter;
  readonly nowMs: number;
}

function receivingLine(counter: EventsSeenCounter, nowMs: number): string {
  // `asOf` is the last completed check, not the newest event: a quiet product
  // still proves the connection is working.
  if (counter.asOf === null) return LANDING_LIVENESS_FIRST_CHECK_PENDING;

  const since = describeSince(counter.asOf, nowMs);

  if (counter.kept === 0) {
    return LANDING_LIVENESS_NOTHING_YET_TEMPLATE.replaceAll("{when}", since);
  }

  return LANDING_LIVENESS_RECEIVING_TEMPLATE.replaceAll("{kept}", String(counter.kept))
    .replaceAll("{total}", String(counter.totalReceived))
    .replaceAll("{when}", since);
}

export function describeLandingLiveness(input: LandingLivenessInput): string {
  const { counter, nowMs } = input;

  switch (counter.state.status) {
    case "not_connected":
      return LANDING_LIVENESS_NOT_CONNECTED;

    case "validating":
      return LANDING_LIVENESS_VALIDATING;

    case "connected_never_polled":
      return LANDING_LIVENESS_FIRST_CHECK_PENDING;

    case "failing":
      return LANDING_LIVENESS_FAILING;

    case "disconnected":
      return LANDING_LIVENESS_DISCONNECTED;

    case "connected_no_events_yet":
    case "connected_receiving":
      return receivingLine(counter, nowMs);
  }
}
