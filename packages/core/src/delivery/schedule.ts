// The delivery scheduler's PURE decision (O-007 FR-6, FR-7, FR-8, FR-9).
//
// One tick, one answer: either we post ONE finding, or we say — out loud, as a
// state a reader can persist and render — that we are not posting one today.
// `@growthmind/shared`'s `deliveryDecisionSchema` already fixes that as a
// two-member union rather than "a finding or nothing", and this module is the
// function that produces it.
//
// ── WHAT LIVES HERE AND WHAT DOES NOT ───────────────────────────────────────
// Here: the judgement. NOT here: the atomic claim. FR-6's "at most one open
// finding per project" is a DB fact — a partial unique index and a single
// atomic statement in `packages/db` — never application discipline. This
// function decides what SHOULD happen given a lane state the caller read; the
// database is what makes it true when two ticks race (D6). A `deliver` decision
// is therefore a proposal the claim may still lose, and the caller must treat a
// lost claim as `one_already_open` rather than as an error.
//
// ── FAIL DIRECTION: WITHHOLD ────────────────────────────────────────────────
// Stated in words, because a scheduler is a gate and every gate fails in some
// direction. On doubt — a delivery count that is not a readable number, a lane
// state that has somehow gone impossible — this function returns
// `nothing_today`, never `deliver`.
//
// The asymmetry that decides it: a withheld finding surfaces on the next tick,
// which is hours away and costs nothing; an extra finding posted into a
// founder's Slack cannot be un-sent, and the whole product decision this lane
// implements (§7 backpressure — "one thing at a time, not a ranked list of
// twelve") is a promise about restraint. Over-delivering breaks the promise
// permanently; under-delivering breaks it for one day. Same direction as
// `../findings/suppression-policy.ts` (suppress on doubt) and
// `./residual-pii.ts` (block on doubt), and the same reasoning: this gate
// withholds an ACTION, not a capability.
//
// ── THE THREE ZEROS STAY DISTINGUISHABLE ────────────────────────────────────
// `NothingTodayReason` exists because "you still owe us an answer on the last
// one", "we are pacing ourselves", and "your product was quiet" are three
// different facts, and collapsing them would reproduce exactly the silence
// `analysisOutcomeSchema` was split to prevent. The branch order below is what
// keeps them honest — see `decideDelivery`.
//
// ── NO VERSION MAP, DELIBERATELY ────────────────────────────────────────────
// `suppressionDecision` dispatches by policy version because a recorded verdict
// must stay re-readable under the rules in force when it was written. A
// scheduler tick is decided once, acted on immediately, and never re-judged, so
// a version map would be ceremony rather than a guarantee. If the day comes
// that a persisted decision is re-evaluated, that is when this grows a version —
// as a decision, not by drift.
//
// Pure: no clock (`now` is a parameter — this package imports no node builtin
// and reads no `Date.now()`), no I/O, no randomness, and NO THROW on any input.
// The state type below is primitives and arrays only — never a drizzle row —
// so the whole scheduler is testable from a literal and `core -> db` stays
// forbidden.
import type { DeliveryDecision, NothingTodayReason } from "@growthmind/shared";

import type { ConfidenceBasis } from "../findings/candidate";

/**
 * The token bucket, as a constant (FR-9, `docs/mvp.md:85-86` — "the token
 * bucket can start as a constant"). A hard ceiling on findings per week,
 * product decisions §7: "Must be hard rate-limited. A ceiling on findings per
 * week, enforced, even when there are more."
 *
 * THIS IS DELIBERATELY A CONSTANT, NOT CONFIGURATION. At MVP volume the
 * one-open-finding invariant (FR-6) already does the pacing — the bucket only
 * bites in the week where a customer answers and dismisses fast enough to open
 * a fourth. Making it configurable today would be a knob with no data behind
 * its default and one more thing per project to keep correct.
 *
 * WHAT REPLACES IT: a real token bucket persisted per project — capacity, a
 * refill rate, and a last-refill instant — read from project configuration, so
 * a high-traffic customer can be told more and a quiet one is not padded to the
 * ceiling. That arrives with real volume (PRD "Deferred: token bucket constant
 * → configuration"), and it replaces this constant with a `capacity` field; the
 * shape of `decideDelivery` does not change, because the budget already enters
 * as a COUNT the caller measured rather than as a clock this function reads.
 */
export const DELIVERY_BUDGET_PER_WEEK = 3;

/**
 * A candidate the scheduler may choose between: the identity, and the two
 * ranking inputs FR-7 names. Deliberately NOT the whole `CandidateFinding` —
 * a scheduler that took the full contract would be untestable without building
 * a branded `MeasuredCount`, and would invite ranking on fields FR-7 did not
 * sanction.
 *
 * `sampleSize` carries BOTH halves because a count in this product never
 * travels without its denominator (`../counts/measured-count.ts`). It is the
 * primitive pair rather than a `MeasuredCount` because these rows come back
 * from persistence, where the brand — a module-private symbol — does not
 * survive (D5); re-validating through `measuredCount()` is the caller's job at
 * the RENDER boundary, not a prerequisite for deciding who goes first.
 *
 * `findingId` is the total order's last key, which is what makes the order
 * TOTAL: two distinct candidates can never tie.
 */
export type DeliveryCandidate = {
  readonly findingId: string;
  readonly confidenceBasis: ConfidenceBasis;
  readonly sampleSize: {
    /** Sessions the claim is about. */
    readonly numerator: number;
    /** The kept sessions it rests on — never absent, never implied. */
    readonly denominator: number;
  };
};

/**
 * Everything about one project's delivery lane this decision needs, as the
 * caller read it.
 *
 * `openFindingIds` is a LIST, not a nullable id: zero rows is the empty array
 * (a fact, not an absence), and a lane that somehow holds two open findings —
 * the DB invariant breached, or read mid-migration — is representable rather
 * than unthinkable, so this function reports `one_already_open` instead of
 * crashing on it (D3).
 *
 * `deliveredThisWeek` is named for the window it must be counted over. The
 * budget is weekly (`DELIVERY_BUDGET_PER_WEEK`); a caller counting a DAY here
 * would silently compare the wrong number against the ceiling, and the field
 * name is the cheapest guard against that stamp/filter asymmetry (D2).
 */
export type DeliveryLaneState = {
  readonly openFindingIds: readonly string[];
  readonly deliveredThisWeek: number;
  readonly candidates: readonly DeliveryCandidate[];
};

/**
 * The tick's answer. A discriminated union on `decision`, never a finding-or-
 * null: `nothing_today` is a POSITIVE answer the customer is owed, and a shape
 * that could express it as an absence would let a caller drop it on the floor.
 *
 * The `decision` literals are typed through `DeliveryDecision` rather than
 * written as bare strings, so a rename in `@growthmind/shared` collapses these
 * arms to `never` and fails `bun run typecheck` here — the wire between the
 * closed union and its only producer is PROVEN, not assumed (D9, D11).
 *
 * `decidedAt` is on BOTH arms because the nothing-today state is persisted
 * (FR-8), and a persisted state with no instant cannot answer "is this today's
 * answer or last Tuesday's?".
 */
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

/** Comparator results, named — `-1`/`1`/`0` say nothing at a call site. */
const A_FIRST = -1;
const B_FIRST = 1;
const NEITHER_FIRST = 0;

/**
 * The confidence half of the total order (FR-7), lowest rank first.
 *
 * Typed `Record<ConfidenceBasis, number>` so a fourth confidence basis is a
 * COMPILE error here rather than a candidate that silently sorts as `NaN`.
 *
 * `below_threshold` is ranked even though `isDeliverable` filters it out
 * first — the map is total because the type says it is, and a comparator that
 * can be handed an ineligible candidate by a direct caller must still return
 * an order rather than an undefined rank.
 */
const CONFIDENCE_RANK: Record<ConfidenceBasis, number> = {
  threshold_met: 0,
  at_threshold: 1,
  below_threshold: 2,
};

/**
 * Whether a candidate may be delivered at all.
 *
 * `below_threshold` is excluded by contract, not by preference:
 * `../findings/candidate.ts` defines that member as "present in the output for
 * provenance, never surfaced as a finding on its own". A below-threshold
 * candidate is evidence that did not clear the bar, and posting one would make
 * every other finding's bar meaningless.
 */
export function isDeliverable(candidate: DeliveryCandidate): boolean {
  return candidate.confidenceBasis !== "below_threshold";
}

/**
 * THE TOTAL ORDER (FR-7). Strict, antisymmetric, and independent of input
 * order. Keys, in fixed priority:
 *
 *   1. `confidenceBasis` — `threshold_met` before `at_threshold`. Evidence that
 *      cleared every threshold outranks evidence sitting exactly on one; the
 *      boundary case is a named member precisely so it can rank lower.
 *   2. `sampleSize.denominator`, LARGER first. The denominator is the kept
 *      sessions the claim rests on, and `rankingInputsSchema` calls it "the
 *      count whose denominator the ranking rests on" — a claim measured across
 *      more of the product is the safer one to spend the week's single slot on.
 *   3. `sampleSize.numerator`, LARGER first. At an equal denominator, more
 *      affected sessions is the bigger problem — "12 of 200" outranks "3 of
 *      200".
 *   4. `findingId`, ascending. The stable tiebreak, and the reason the order is
 *      TOTAL: ids are unique, so two DISTINCT candidates can never tie and the
 *      choice can never fall through to array order. A test asserts exactly
 *      that by shuffling the input.
 *
 * Comparisons are explicit `<`/`>` rather than subtraction, so an unreadable
 * magnitude (a `NaN` denominator arriving from a malformed persisted row)
 * FALLS THROUGH to the next key instead of poisoning the comparator with `NaN`
 * — a comparator that returns `NaN` produces an implementation-defined order,
 * which is the one thing this function exists not to do.
 */
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

/**
 * Whether this week's budget has room left.
 *
 * FAIL DIRECTION: a count we cannot read is treated as SPENT. A negative,
 * fractional, or non-finite `deliveredThisWeek` means the caller's own
 * measurement is broken, and the safe reading of a broken budget is "we have
 * already posted enough" — never "post another one". This is the D5 shape
 * check and the D10 fail direction in the same function, and it is why this
 * returns a boolean rather than throwing: a scheduler that throws takes down
 * the lane it was added to pace (D8).
 */
function budgetRemains(deliveredThisWeek: number): boolean {
  if (!Number.isInteger(deliveredThisWeek) || deliveredThisWeek < 0) return false;
  return deliveredThisWeek < DELIVERY_BUDGET_PER_WEEK;
}

/** One arm of the union, built in one place so `decidedAt` is never forgotten. */
function nothingToday(reason: NothingTodayReason, decidedAt: Date): ScheduleDecision {
  return { decision: "nothing_today", reason, decidedAt };
}

/**
 * Decide what this project's delivery lane does on this tick.
 *
 * `now` is a PARAMETER, never a clock read: `packages/core` imports no node
 * builtin and this package's purity scan is what makes that auditable. The
 * caller owns the clock, uses it to count `deliveredThisWeek` over the week
 * containing `now`, and gets it back stamped on the decision it persists.
 *
 * ── BRANCH ORDER IS FIXED AND TESTED ────────────────────────────────────────
 * A reordering here is a behaviour change, not a refactor:
 *
 *   1. a finding is already open      → nothing_today / one_already_open
 *   2. the week's budget is spent     → nothing_today / budget_spent
 *   3. no eligible candidate          → nothing_today / no_findings_ready
 *   4. otherwise                      → deliver, the first of the total order
 *
 * OUR-SIDE GATES COME FIRST, AND THAT IS THE WHOLE POINT OF THE ORDER.
 * `no_findings_ready` is the only reason that makes a claim about the
 * CUSTOMER'S PRODUCT — "we looked at what happened and nothing rose to the
 * bar". We may only say that when we actually looked and would have posted.
 * If we were going to withhold anyway — because they still owe us an answer on
 * the last finding, or because we are pacing ourselves — then reporting "your
 * product was quiet" is us blaming their product for our own restraint. That
 * is the exact collapse `NothingTodayReason` was split to prevent, and it is
 * why (1) and (2) are checked before the candidate list is even consulted.
 *
 * (1) before (2) because the one-open-finding invariant holds REGARDLESS of the
 * bucket balance (FR-9: "backpressure is the invariant; the bucket is a ceiling
 * on top"), and because `one_already_open` is the more actionable of the two —
 * the customer can clear it by answering, whereas a spent budget only clears
 * with time.
 */
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

  // `toSorted`, never `sort`: the caller's array is not ours to reorder, and a
  // scheduler that mutated the candidate list it was handed would make its own
  // determinism depend on how many times it had been called.
  const [chosen] = eligible.toSorted(compareDeliveryCandidates);

  return { decision: "deliver", finding: chosen, decidedAt: now };
}
