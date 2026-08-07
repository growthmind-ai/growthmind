import {
  DELIVERY_SILENCE_BEFORE_ALARM_MS,
  DELIVERY_TICK_INTERVAL_MS,
  deliverySilenceMs,
  deliveryTicksSince,
} from "@growthmind/core";
import {
  ALL_DELIVERY_MESSAGES,
  DELIVERY_LANE_DECISION_MESSAGES,
  type DeliveryLaneDecision,
} from "@growthmind/shared";

import { dayMonth, dayMonthTime, spanOfDays } from "./format";

export interface LaneRunFacts {
  readonly decision: DeliveryLaneDecision;
  readonly reason: string;
  readonly firstDecidedAt: Date;
  readonly lastDecidedAt: Date;
}

export type LaneTone = "quiet" | "alarm" | "cold";

export interface LaneLine {
  readonly tone: LaneTone;
  readonly head: string;
  readonly body: string;
}

// Rendering all eight decisions as a status line would turn a receipt book into a dashboard,
// so the lane speaks only where the cards and the banner are silent.
type Prominence = "silent" | "covered" | "quiet" | "alarm";

const PROMINENCE: Record<DeliveryLaneDecision, Prominence> = {
  posted: "silent",
  failed: "silent",
  blocked_by_pii: "silent",
  not_claimed: "silent",

  not_connected: "covered",

  nothing_today: "quiet",

  unresolvable: "alarm",
  lane_errored: "alarm",
};

const ALARM_HEAD: Partial<Record<DeliveryLaneDecision, string>> = {
  unresolvable: "We lost track of something we meant to send.",
  lane_errored: "Our last run did not finish.",
};

const TICK_MINUTES = Math.round(DELIVERY_TICK_INTERVAL_MS / 60_000);

export const NEVER_CHECKED: LaneLine = {
  tone: "cold",
  head: "We have not looked yet.",
  body: `The first check runs within ${TICK_MINUTES} minutes. Nothing is wrong.`,
};

// Verbatim, never composed from `decision`: the three quiet reasons differ in ways a founder
// cares about. A sentence outside the shared vocabulary is replaced, not printed (D5, D10).
function reasonOf(run: LaneRunFacts): string {
  const stored = run.reason.trim();
  return ALL_DELIVERY_MESSAGES.includes(stored)
    ? stored
    : DELIVERY_LANE_DECISION_MESSAGES[run.decision];
}

export function laneLine(run: LaneRunFacts | null, now: Date): LaneLine | null {
  // No open run is "we have not been asked", not "we were found silent". Merging the two
  // greets every new customer with an alarm.
  if (run === null) {
    return NEVER_CHECKED;
  }

  // Duration against duration. The tick count below is only for copy that names the
  // schedule, which is the one thing it is safe to derive.
  if (deliverySilenceMs(run.lastDecidedAt, now) >= DELIVERY_SILENCE_BEFORE_ALARM_MS) {
    const missed = deliveryTicksSince(run.lastDecidedAt, now);
    return {
      tone: "alarm",
      head: `We have not checked since ${dayMonthTime(run.lastDecidedAt)}.`,
      body:
        `We should have looked ${missed} times since then and did not. This is our problem, ` +
        `not yours, and nothing below is out of date — it just is not being added to.`,
    };
  }

  const prominence = PROMINENCE[run.decision];
  if (prominence === "silent" || prominence === "covered") {
    return null;
  }

  if (prominence === "alarm") {
    return {
      tone: "alarm",
      head: ALARM_HEAD[run.decision] ?? DELIVERY_LANE_DECISION_MESSAGES[run.decision],
      body: reasonOf(run),
    };
  }

  // `first_decided_at`, never a count of rows: consecutive ticks with the same answer extend
  // one row, so counting would report four quiet days as one.
  return {
    tone: "quiet",
    head: `Quiet since ${dayMonth(run.firstDecidedAt)}.`,
    body: reasonOf(run),
  };
}

export interface LaneHistoryRow {
  readonly key: string;
  readonly when: string;
  readonly what: string;
}

export function laneHistory(runs: readonly LaneRunFacts[]): readonly LaneHistoryRow[] {
  return runs.map((run) => ({
    key: `${run.firstDecidedAt.toISOString()}-${run.decision}`,
    when: spanOfDays(run.firstDecidedAt, run.lastDecidedAt),
    what: reasonOf(run),
  }));
}
