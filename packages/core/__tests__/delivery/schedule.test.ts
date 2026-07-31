// The delivery scheduler's pure decision (O-007 FR-6, FR-7, FR-8, FR-9).
//
// This suite is organised around the two things a scheduler can get wrong, and
// neither of them is arithmetic:
//
//   1. DELIVERING WHEN IT SHOULD HAVE WITHHELD. The declared fail direction is
//      WITHHOLD (`schedule.ts` header): a withheld finding surfaces on the next
//      tick, an extra one posted into a founder's Slack cannot be un-sent. Every
//      doubt case below asserts `nothing_today`.
//
//   2. TELLING THE CUSTOMER THE WRONG ZERO. `one_already_open`, `budget_spent`,
//      and `no_findings_ready` are three different facts — "you still owe us an
//      answer", "we are pacing ourselves", "your product was quiet" — and only
//      the last one is a claim about the customer's product. The branch-order
//      tests are what stop our own restraint being reported as their silence.
//
// Pure: no clock. Every instant here descends from the frozen constant below,
// and `decideDelivery` takes `now` as a parameter precisely so this file never
// has to reach for one.
import { NOTHING_TODAY_REASONS } from "@growthmind/shared";
import type { NothingTodayReason } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import {
  DELIVERY_BUDGET_PER_WEEK,
  compareDeliveryCandidates,
  decideDelivery,
  isDeliverable,
} from "../../src/delivery/schedule";
import type { DeliveryCandidate, DeliveryLaneState } from "../../src/delivery/schedule";

// ── fixtures ──────────────────────────────────────────────────────────────

const NOW = new Date("2026-07-30T09:00:00.000Z");

/** A candidate that would be delivered if nothing else stood in the way. */
function candidate(overrides: Partial<DeliveryCandidate> = {}): DeliveryCandidate {
  return {
    findingId: "f-mid",
    confidenceBasis: "threshold_met",
    sampleSize: { numerator: 5, denominator: 50 },
    ...overrides,
  };
}

/** A lane with room in the budget, nothing open, and whatever candidates. */
function lane(overrides: Partial<DeliveryLaneState> = {}): DeliveryLaneState {
  return {
    openFindingIds: [],
    deliveredThisWeek: 0,
    candidates: [candidate()],
    ...overrides,
  };
}

/** Every ordering of a small list — the "independent of input order" proof. */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];

  const ordered: T[][] = [];
  for (const [index, item] of items.entries()) {
    const rest = items.toSpliced(index, 1);
    for (const tail of permutations(rest)) {
      tail.unshift(item);
      ordered.push(tail);
    }
  }
  return ordered;
}

// ── one open finding at a time (FR-6) ─────────────────────────────────────

describe("decideDelivery — one open finding at a time", () => {
  test("should return nothing_today with reason one_already_open when a finding is already open", () => {
    const decision = decideDelivery(lane({ openFindingIds: ["f-open"] }), NOW);

    expect(decision).toEqual({
      decision: "nothing_today",
      reason: "one_already_open",
      decidedAt: NOW,
    });
  });

  test("should return one_already_open even when a stronger candidate is waiting", () => {
    // The candidate here outranks anything: top confidence, largest sample.
    // Backpressure is not a ranking input — it is the invariant (§7, "one
    // thing at a time, not a ranked list of twelve").
    const decision = decideDelivery(
      lane({
        openFindingIds: ["f-open"],
        candidates: [
          candidate({
            findingId: "f-huge",
            confidenceBasis: "threshold_met",
            sampleSize: { numerator: 900, denominator: 1000 },
          }),
        ],
      }),
      NOW,
    );

    expect(decision.decision).toBe("nothing_today");
    expect(decision).toMatchObject({ reason: "one_already_open" });
  });

  test("should return one_already_open regardless of how much budget remains", () => {
    // FR-9: "the scheduler refuses to open a second finding while one is open
    // regardless of bucket balance — backpressure is the invariant; the bucket
    // is a ceiling on top."
    for (let spent = 0; spent < DELIVERY_BUDGET_PER_WEEK; spent += 1) {
      const decision = decideDelivery(
        lane({ openFindingIds: ["f-open"], deliveredThisWeek: spent }),
        NOW,
      );

      expect(decision).toMatchObject({ reason: "one_already_open" });
    }
  });

  test("should report one_already_open rather than crash when more than one finding is open", () => {
    // The DB invariant says this cannot happen. A read mid-migration, or a
    // breached index, says it can — and a scheduler whose response to an
    // impossible state is an exception takes down the lane it paces (D8).
    const decision = decideDelivery(lane({ openFindingIds: ["f-a", "f-b"] }), NOW);

    expect(decision).toMatchObject({ reason: "one_already_open" });
  });
});

// ── nothing ready (FR-8) ──────────────────────────────────────────────────

describe("decideDelivery — nothing ready to say", () => {
  test("should return nothing_today with reason no_findings_ready when there are no candidates", () => {
    const decision = decideDelivery(lane({ candidates: [] }), NOW);

    expect(decision).toEqual({
      decision: "nothing_today",
      reason: "no_findings_ready",
      decidedAt: NOW,
    });
  });

  test("should return no_findings_ready when every candidate is below_threshold", () => {
    // `below_threshold` is "present in the output for provenance, never
    // surfaced as a finding on its own" (`findings/candidate.ts`). A lane full
    // of them is a lane with nothing to say, not a lane with three options.
    const decision = decideDelivery(
      lane({
        candidates: [
          candidate({ findingId: "f-a", confidenceBasis: "below_threshold" }),
          candidate({
            findingId: "f-b",
            confidenceBasis: "below_threshold",
            sampleSize: { numerator: 400, denominator: 500 },
          }),
        ],
      }),
      NOW,
    );

    expect(decision).toMatchObject({ reason: "no_findings_ready" });
  });

  test("should never select a below_threshold candidate even when it is the largest", () => {
    const decision = decideDelivery(
      lane({
        candidates: [
          candidate({
            findingId: "f-big-but-weak",
            confidenceBasis: "below_threshold",
            sampleSize: { numerator: 900, denominator: 1000 },
          }),
          candidate({
            findingId: "f-small-but-proven",
            confidenceBasis: "at_threshold",
            sampleSize: { numerator: 3, denominator: 30 },
          }),
        ],
      }),
      NOW,
    );

    expect(decision).toMatchObject({
      decision: "deliver",
      finding: { findingId: "f-small-but-proven" },
    });
  });
});

// ── the token bucket (FR-9) ───────────────────────────────────────────────

describe("decideDelivery — the weekly budget", () => {
  test("should deliver at one under the weekly budget", () => {
    const decision = decideDelivery(lane({ deliveredThisWeek: DELIVERY_BUDGET_PER_WEEK - 1 }), NOW);

    expect(decision).toMatchObject({ decision: "deliver" });
  });

  test("should return budget_spent at exactly the weekly budget", () => {
    // The boundary pair with the test above: the ceiling is INCLUSIVE-spent —
    // having posted `DELIVERY_BUDGET_PER_WEEK` findings means the week is done,
    // not that one more is owed.
    const decision = decideDelivery(lane({ deliveredThisWeek: DELIVERY_BUDGET_PER_WEEK }), NOW);

    expect(decision).toEqual({
      decision: "nothing_today",
      reason: "budget_spent",
      decidedAt: NOW,
    });
  });

  test("should return budget_spent above the weekly budget rather than delivering", () => {
    const decision = decideDelivery(lane({ deliveredThisWeek: DELIVERY_BUDGET_PER_WEEK + 5 }), NOW);

    expect(decision).toMatchObject({ reason: "budget_spent" });
  });

  test("should treat an unreadable delivery count as budget spent rather than delivering", () => {
    // FAIL DIRECTION, asserted rather than commented. A count that is negative,
    // fractional, or not a number at all means the caller's measurement is
    // broken; the safe reading of a broken budget is "we have posted enough".
    const unreadable = [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY];

    expect(unreadable.length).toBeGreaterThan(0);
    for (const deliveredThisWeek of unreadable) {
      expect(decideDelivery(lane({ deliveredThisWeek }), NOW)).toMatchObject({
        reason: "budget_spent",
      });
    }
  });
});

// ── branch order: whose silence is it? (FR-8) ─────────────────────────────

describe("decideDelivery — branch order keeps the three zeros honest", () => {
  test("should report budget_spent, not no_findings_ready, when the budget is spent and nothing is ready", () => {
    // Both facts are true. Only one of them is ours. Reporting "your product
    // was quiet" when we would have withheld anyway blames the customer's
    // product for our own pacing — the exact collapse `NothingTodayReason`
    // exists to prevent.
    const decision = decideDelivery(
      lane({ deliveredThisWeek: DELIVERY_BUDGET_PER_WEEK, candidates: [] }),
      NOW,
    );

    expect(decision).toMatchObject({ reason: "budget_spent" });
  });

  test("should report one_already_open, not budget_spent, when both gates would withhold", () => {
    const decision = decideDelivery(
      lane({
        openFindingIds: ["f-open"],
        deliveredThisWeek: DELIVERY_BUDGET_PER_WEEK,
        candidates: [],
      }),
      NOW,
    );

    expect(decision).toMatchObject({ reason: "one_already_open" });
  });

  test("should produce every NothingTodayReason the shared union declares", () => {
    // Completeness in the direction that matters: this function is the ONLY
    // producer of these three reasons, so a member nothing can emit is a state
    // the customer will never be told — a dead member of a closed union (D11).
    const produced = new Set<NothingTodayReason>();

    for (const state of [
      lane({ openFindingIds: ["f-open"] }),
      lane({ deliveredThisWeek: DELIVERY_BUDGET_PER_WEEK }),
      lane({ candidates: [] }),
    ]) {
      const decision = decideDelivery(state, NOW);
      if (decision.decision === "nothing_today") produced.add(decision.reason);
    }

    // NON-VACUITY: the roster is real before "every member is covered" means
    // anything.
    expect(NOTHING_TODAY_REASONS.length).toBe(3);
    expect([...produced].toSorted()).toEqual([...NOTHING_TODAY_REASONS].toSorted());
  });
});

// ── the total order (FR-7) ────────────────────────────────────────────────

describe("decideDelivery — exactly one candidate, chosen deterministically", () => {
  test("should choose exactly one candidate when several are eligible", () => {
    const decision = decideDelivery(
      lane({
        candidates: [
          candidate({ findingId: "f-a" }),
          candidate({ findingId: "f-b" }),
          candidate({ findingId: "f-c" }),
        ],
      }),
      NOW,
    );

    expect(decision.decision).toBe("deliver");
    // The union carries ONE finding, not a ranked list — a ranked list is a
    // dashboard with extra steps (§7).
    expect(decision).toMatchObject({ finding: { findingId: "f-a" } });
  });

  test("should choose the same candidate for every permutation of the input order", () => {
    const candidates = [
      candidate({
        findingId: "f-at-threshold",
        confidenceBasis: "at_threshold",
        sampleSize: { numerator: 90, denominator: 900 },
      }),
      candidate({
        findingId: "f-met-small",
        confidenceBasis: "threshold_met",
        sampleSize: { numerator: 4, denominator: 40 },
      }),
      candidate({
        findingId: "f-met-large",
        confidenceBasis: "threshold_met",
        sampleSize: { numerator: 9, denominator: 90 },
      }),
    ];

    const orderings = permutations(candidates);
    // NON-VACUITY: 3! = 6 orderings, not one list standing in for "every order".
    expect(orderings.length).toBe(6);

    const chosen = new Set(
      orderings.map((candidates_) => {
        const decision = decideDelivery(lane({ candidates: candidates_ }), NOW);
        return decision.decision === "deliver" ? decision.finding.findingId : decision.reason;
      }),
    );

    expect([...chosen]).toEqual(["f-met-large"]);
  });

  test("should prefer threshold_met over at_threshold even when at_threshold rests on more sessions", () => {
    // Key 1 beats key 2: evidence that cleared every threshold outranks
    // evidence sitting exactly on one, whatever its sample.
    const decision = decideDelivery(
      lane({
        candidates: [
          candidate({
            findingId: "f-boundary",
            confidenceBasis: "at_threshold",
            sampleSize: { numerator: 500, denominator: 5000 },
          }),
          candidate({
            findingId: "f-clear",
            confidenceBasis: "threshold_met",
            sampleSize: { numerator: 2, denominator: 20 },
          }),
        ],
      }),
      NOW,
    );

    expect(decision).toMatchObject({ finding: { findingId: "f-clear" } });
  });

  test("should prefer the larger denominator between two candidates of equal confidence", () => {
    const decision = decideDelivery(
      lane({
        candidates: [
          candidate({ findingId: "f-narrow", sampleSize: { numerator: 8, denominator: 20 } }),
          candidate({ findingId: "f-broad", sampleSize: { numerator: 8, denominator: 200 } }),
        ],
      }),
      NOW,
    );

    expect(decision).toMatchObject({ finding: { findingId: "f-broad" } });
  });

  test("should prefer more affected sessions when the denominators tie", () => {
    const decision = decideDelivery(
      lane({
        candidates: [
          candidate({ findingId: "f-few", sampleSize: { numerator: 3, denominator: 200 } }),
          candidate({ findingId: "f-many", sampleSize: { numerator: 12, denominator: 200 } }),
        ],
      }),
      NOW,
    );

    expect(decision).toMatchObject({ finding: { findingId: "f-many" } });
  });

  test("should break a full tie on finding id, never on array order", () => {
    // Two candidates identical in every ranking input. Without the id tiebreak
    // the winner would be whichever the array happened to list first — a
    // choice that changes when an unrelated query's ORDER BY changes.
    const first = candidate({ findingId: "f-aaa" });
    const second = candidate({ findingId: "f-bbb" });

    const forwards = decideDelivery(lane({ candidates: [first, second] }), NOW);
    const backwards = decideDelivery(lane({ candidates: [second, first] }), NOW);

    expect(forwards).toEqual(backwards);
    expect(forwards).toMatchObject({ finding: { findingId: "f-aaa" } });
  });

  test("should not reorder the caller's candidate array", () => {
    // `toSorted`, never `sort`: a scheduler that mutated its input would make
    // its own determinism depend on how many times it had been called.
    const candidates = [
      candidate({ findingId: "f-z", sampleSize: { numerator: 1, denominator: 10 } }),
      candidate({ findingId: "f-a", sampleSize: { numerator: 9, denominator: 90 } }),
    ];

    decideDelivery(lane({ candidates }), NOW);

    expect(candidates.map((c) => c.findingId)).toEqual(["f-z", "f-a"]);
  });
});

// ── the comparator, on its own (FR-7) ─────────────────────────────────────

describe("compareDeliveryCandidates — a strict, total order", () => {
  const corpus: readonly DeliveryCandidate[] = [
    candidate({ findingId: "f-1", confidenceBasis: "threshold_met" }),
    candidate({
      findingId: "f-2",
      confidenceBasis: "threshold_met",
      sampleSize: { numerator: 5, denominator: 500 },
    }),
    candidate({
      findingId: "f-3",
      confidenceBasis: "at_threshold",
      sampleSize: { numerator: 50, denominator: 500 },
    }),
    candidate({ findingId: "f-4", confidenceBasis: "below_threshold" }),
    candidate({ findingId: "f-5", confidenceBasis: "at_threshold" }),
  ];

  test("should order every distinct pair strictly, never reporting a tie", () => {
    // NON-VACUITY: a corpus of one pair would pass this trivially.
    expect(corpus.length).toBeGreaterThan(4);

    for (const a of corpus) {
      for (const b of corpus) {
        if (a.findingId === b.findingId) continue;
        expect(compareDeliveryCandidates(a, b)).not.toBe(0);
      }
    }
  });

  test("should be antisymmetric for every pair, and zero only against itself", () => {
    for (const a of corpus) {
      expect(compareDeliveryCandidates(a, a)).toBe(0);
      for (const b of corpus) {
        // Summed rather than negated: `-Math.sign(0)` is `-0`, and `toBe` is
        // `Object.is`, which distinguishes `-0` from `0`. The sum states the
        // property (`sign(a,b) === -sign(b,a)`) without that trap.
        expect(
          Math.sign(compareDeliveryCandidates(a, b)) + Math.sign(compareDeliveryCandidates(b, a)),
        ).toBe(0);
      }
    }
  });

  test("should order deterministically when a magnitude is not a readable number", () => {
    // A `NaN` denominator arriving from a malformed persisted row must fall
    // through to the next key, not poison the comparator: a comparator
    // returning `NaN` produces an implementation-defined order, which is the
    // one thing this function exists not to do.
    const broken = candidate({
      findingId: "f-broken",
      sampleSize: { numerator: Number.NaN, denominator: Number.NaN },
    });
    const sound = candidate({ findingId: "f-sound" });

    expect(compareDeliveryCandidates(broken, sound)).toBe(
      -compareDeliveryCandidates(sound, broken),
    );
    expect(compareDeliveryCandidates(broken, sound)).not.toBe(0);
  });
});

describe("isDeliverable — the eligibility gate", () => {
  test("should refuse a below_threshold candidate and admit the other two bases", () => {
    expect(isDeliverable(candidate({ confidenceBasis: "below_threshold" }))).toBe(false);
    expect(isDeliverable(candidate({ confidenceBasis: "at_threshold" }))).toBe(true);
    expect(isDeliverable(candidate({ confidenceBasis: "threshold_met" }))).toBe(true);
  });
});

// ── purity ────────────────────────────────────────────────────────────────

describe("decideDelivery — purity (no clock, no I/O)", () => {
  test("should stamp decidedAt from the caller's now rather than reading a clock", () => {
    const other = new Date("2019-01-01T00:00:00.000Z");

    expect(decideDelivery(lane(), NOW).decidedAt).toBe(NOW);
    expect(decideDelivery(lane({ candidates: [] }), other).decidedAt).toBe(other);
  });

  test("should return byte-identical decisions for the same state across two calls", () => {
    // A frozen literal state called twice: a scheduler that consulted a clock,
    // a random tiebreak, or any I/O could not make this guarantee.
    const state = lane({
      candidates: [candidate({ findingId: "f-a" }), candidate({ findingId: "f-b" })],
    });

    expect(decideDelivery(state, NOW)).toEqual(decideDelivery(state, NOW));
  });
});
