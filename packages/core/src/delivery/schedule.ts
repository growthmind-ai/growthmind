import type { DeliveryDecision, NothingTodayReason } from "@growthmind/shared";

import type { ConfidenceBasis } from "../findings/candidate";
import { compareExpectedValue, expectedValueOf } from "../growth/expected-value";
import type { SurfaceWorth } from "../growth/surface-worth";

export const DELIVERY_BUDGET_PER_WEEK = 3;

// How often the delivery tick runs. The worker's crontab is the thing that actually schedules
// it, and `delivery-tick.test.ts` fails if the two disagree — a reader deriving anything from
// this value is otherwise reading a number nothing enforces.
export const DELIVERY_TICK_INTERVAL_MS = 15 * 60 * 1_000;

// A claim is a lease, and a lease with no expiry is a deadlock. A tick that dies between
// claiming a delivery and recording its outcome leaves the row `pending`, and `pending` is
// read by every later tick as work in progress — so the lane returns `one_already_open`
// forever and the organization silently stops receiving anything. Two ticks' headroom: long
// enough that a slow post is never stolen, short enough that a lost claim costs half an hour
// rather than the rest of the installation's life.
export const DELIVERY_CLAIM_TTL_MS = 2 * DELIVERY_TICK_INTERVAL_MS;

// Claims older than this are abandoned, not in flight.
export function deliveryClaimsExpireBefore(at: Date): Date {
  return new Date(at.getTime() - DELIVERY_CLAIM_TTL_MS);
}

// How many ticks a lane has gone without reaching a decision. A worker that throws records
// `lane_errored`; a worker that stops records nothing at all, and this is the only thing that
// separates it from a genuinely quiet lane. Deliberately a count and not a verdict: how many
// missed ticks are too many is a product call, not one to settle here.
export function deliveryTicksSince(lastDecidedAt: Date, now: Date): number {
  const elapsed = now.getTime() - lastDecidedAt.getTime();
  return elapsed <= 0 ? 0 : Math.floor(elapsed / DELIVERY_TICK_INTERVAL_MS);
}

export type DeliveryCandidate = {
  readonly findingId: string;
  readonly confidenceBasis: ConfidenceBasis;
  readonly sampleSize: {
    readonly numerator: number;

    readonly denominator: number;
  };

  // Resolved on every read, never persisted alongside the finding: a customer correcting
  // what a surface is worth has to reorder the queue on the next tick, not from the next
  // finding onwards. See .ai/decisions/0013-expected-value-ranking.md
  readonly worth: SurfaceWorth;
};

export type DeliveryLaneState = {
  readonly openFindingIds: readonly string[];
  readonly deliveredThisWeek: number;
  readonly candidates: readonly DeliveryCandidate[];
};

export type ScheduleDecision =
  | {
      readonly decision: Extract<DeliveryDecision, "deliver">;
      readonly finding: DeliveryCandidate;
      readonly decidedAt: Date;
    }
  | {
      readonly decision: Extract<DeliveryDecision, "nothing_today">;
      readonly reason: NothingTodayReason;
      readonly decidedAt: Date;
    };

const A_FIRST = -1;
const B_FIRST = 1;
const NEITHER_FIRST = 0;

const CONFIDENCE_RANK: Record<ConfidenceBasis, number> = {
  threshold_met: 0,
  at_threshold: 1,
  below_threshold: 2,
};

export function isDeliverable(candidate: DeliveryCandidate): boolean {
  return candidate.confidenceBasis !== "below_threshold";
}

export function compareDeliveryCandidates(a: DeliveryCandidate, b: DeliveryCandidate): number {
  const rankA = CONFIDENCE_RANK[a.confidenceBasis];
  const rankB = CONFIDENCE_RANK[b.confidenceBasis];
  if (rankA < rankB) return A_FIRST;
  if (rankA > rankB) return B_FIRST;

  // After confidence, never before it: §6 ranks by expected value, and it also refuses a
  // call the evidence cannot support. A surface worth eight times another does not lift a
  // finding above one whose evidence is stronger.
  const byExpectedValue = compareExpectedValue(
    expectedValueOf(a.sampleSize.numerator, a.worth),
    expectedValueOf(b.sampleSize.numerator, b.worth),
  );
  if (byExpectedValue !== NEITHER_FIRST) return byExpectedValue;

  if (a.sampleSize.denominator > b.sampleSize.denominator) return A_FIRST;
  if (a.sampleSize.denominator < b.sampleSize.denominator) return B_FIRST;

  if (a.sampleSize.numerator > b.sampleSize.numerator) return A_FIRST;
  if (a.sampleSize.numerator < b.sampleSize.numerator) return B_FIRST;

  if (a.findingId < b.findingId) return A_FIRST;
  if (a.findingId > b.findingId) return B_FIRST;

  return NEITHER_FIRST;
}

function budgetRemains(deliveredThisWeek: number): boolean {
  if (!Number.isInteger(deliveredThisWeek) || deliveredThisWeek < 0) return false;
  return deliveredThisWeek < DELIVERY_BUDGET_PER_WEEK;
}

function nothingToday(reason: NothingTodayReason, decidedAt: Date): ScheduleDecision {
  return { decision: "nothing_today", reason, decidedAt };
}

export function decideDelivery(lane: DeliveryLaneState, now: Date): ScheduleDecision {
  if (lane.openFindingIds.length > 0) {
    return nothingToday("one_already_open", now);
  }

  if (!budgetRemains(lane.deliveredThisWeek)) {
    return nothingToday("budget_spent", now);
  }

  const eligible = lane.candidates.filter(isDeliverable);
  if (eligible.length === 0) {
    return nothingToday("no_findings_ready", now);
  }

  const [chosen] = eligible.toSorted(compareDeliveryCandidates);

  return { decision: "deliver", finding: chosen, decidedAt: now };
}
