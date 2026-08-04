import type { DeliveryDecision, NothingTodayReason } from "@growthmind/shared";

import type { ConfidenceBasis } from "../findings/candidate";

export const DELIVERY_BUDGET_PER_WEEK = 3;

// A claim is a lease, and a lease with no expiry is a deadlock. A tick that dies between
// claiming a delivery and recording its outcome leaves the row `pending`, and `pending` is
// read by every later tick as work in progress — so the lane returns `one_already_open`
// forever and the organization silently stops receiving anything. Two ticks' headroom over
// the 15-minute cadence: long enough that a slow post is never stolen, short enough that a
// lost claim costs half an hour rather than the rest of the installation's life.
export const DELIVERY_CLAIM_TTL_MS = 30 * 60 * 1_000;

// Claims older than this are abandoned, not in flight.
export function deliveryClaimsExpireBefore(at: Date): Date {
  return new Date(at.getTime() - DELIVERY_CLAIM_TTL_MS);
}

export type DeliveryCandidate = {
  readonly findingId: string;
  readonly confidenceBasis: ConfidenceBasis;
  readonly sampleSize: {
    readonly numerator: number;

    readonly denominator: number;
  };
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
