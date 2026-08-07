import { NOTHING_TODAY_REASONS } from "@growthmind/shared";
import type { NothingTodayReason } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import {
  DELIVERY_BUDGET_PER_WEEK,
  DELIVERY_CLAIM_TTL_MS,
  DELIVERY_TICK_INTERVAL_MS,
  compareDeliveryCandidates,
  decideDelivery,
  deliveryClaimsExpireBefore,
  deliverySilenceMs,
  deliveryTicksSince,
  isDeliverable,
} from "../../src/delivery/schedule";
import type { DeliveryCandidate, DeliveryLaneState } from "../../src/delivery/schedule";
import { surfaceWorth, unknownWorth } from "../../src/growth/surface-worth";
import type { SurfaceRole } from "@growthmind/shared";

const NOW = new Date("2026-07-30T09:00:00.000Z");

function candidate(overrides: Partial<DeliveryCandidate> = {}): DeliveryCandidate {
  return {
    findingId: "f-mid",
    confidenceBasis: "threshold_met",
    sampleSize: { numerator: 5, denominator: 50 },
    worth: unknownWorth("/checkout"),
    ...overrides,
  };
}

function lane(overrides: Partial<DeliveryLaneState> = {}): DeliveryLaneState {
  return {
    openFindingIds: [],
    deliveredThisWeek: 0,
    candidates: [candidate()],
    ...overrides,
  };
}

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
    for (let spent = 0; spent < DELIVERY_BUDGET_PER_WEEK; spent += 1) {
      const decision = decideDelivery(
        lane({ openFindingIds: ["f-open"], deliveredThisWeek: spent }),
        NOW,
      );

      expect(decision).toMatchObject({ reason: "one_already_open" });
    }
  });

  test("should report one_already_open rather than crash when more than one finding is open", () => {
    const decision = decideDelivery(lane({ openFindingIds: ["f-a", "f-b"] }), NOW);

    expect(decision).toMatchObject({ reason: "one_already_open" });
  });
});

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

describe("decideDelivery — the weekly budget", () => {
  test("should deliver at one under the weekly budget", () => {
    const decision = decideDelivery(lane({ deliveredThisWeek: DELIVERY_BUDGET_PER_WEEK - 1 }), NOW);

    expect(decision).toMatchObject({ decision: "deliver" });
  });

  test("should return budget_spent at exactly the weekly budget", () => {
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
    const unreadable = [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY];

    expect(unreadable.length).toBeGreaterThan(0);
    for (const deliveredThisWeek of unreadable) {
      expect(decideDelivery(lane({ deliveredThisWeek }), NOW)).toMatchObject({
        reason: "budget_spent",
      });
    }
  });
});

describe("decideDelivery — branch order keeps the three zeros honest", () => {
  test("should report budget_spent, not no_findings_ready, when the budget is spent and nothing is ready", () => {
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
    const produced = new Set<NothingTodayReason>();

    for (const state of [
      lane({ openFindingIds: ["f-open"] }),
      lane({ deliveredThisWeek: DELIVERY_BUDGET_PER_WEEK }),
      lane({ candidates: [] }),
    ]) {
      const decision = decideDelivery(state, NOW);
      if (decision.decision === "nothing_today") produced.add(decision.reason);
    }

    expect(NOTHING_TODAY_REASONS.length).toBe(3);
    expect([...produced].toSorted()).toEqual([...NOTHING_TODAY_REASONS].toSorted());
  });
});

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
    const first = candidate({ findingId: "f-aaa" });
    const second = candidate({ findingId: "f-bbb" });

    const forwards = decideDelivery(lane({ candidates: [first, second] }), NOW);
    const backwards = decideDelivery(lane({ candidates: [second, first] }), NOW);

    expect(forwards).toEqual(backwards);
    expect(forwards).toMatchObject({ finding: { findingId: "f-aaa" } });
  });

  test("should not reorder the caller's candidate array", () => {
    const candidates = [
      candidate({ findingId: "f-z", sampleSize: { numerator: 1, denominator: 10 } }),
      candidate({ findingId: "f-a", sampleSize: { numerator: 9, denominator: 90 } }),
    ];

    decideDelivery(lane({ candidates }), NOW);

    expect(candidates.map((c) => c.findingId)).toEqual(["f-z", "f-a"]);
  });
});

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
        expect(
          Math.sign(compareDeliveryCandidates(a, b)) + Math.sign(compareDeliveryCandidates(b, a)),
        ).toBe(0);
      }
    }
  });

  test("should order deterministically when a magnitude is not a readable number", () => {
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

describe("decideDelivery — purity (no clock, no I/O)", () => {
  test("should stamp decidedAt from the caller's now rather than reading a clock", () => {
    const other = new Date("2019-01-01T00:00:00.000Z");

    expect(decideDelivery(lane(), NOW).decidedAt).toBe(NOW);
    expect(decideDelivery(lane({ candidates: [] }), other).decidedAt).toBe(other);
  });

  test("should return byte-identical decisions for the same state across two calls", () => {
    const state = lane({
      candidates: [candidate({ findingId: "f-a" }), candidate({ findingId: "f-b" })],
    });

    expect(decideDelivery(state, NOW)).toEqual(decideDelivery(state, NOW));
  });
});

describe("deliveryClaimsExpireBefore", () => {
  const AT = new Date("2026-08-04T12:00:00.000Z");

  test("a claim expires exactly one TTL before the instant asked about", () => {
    expect(deliveryClaimsExpireBefore(AT).getTime()).toBe(AT.getTime() - DELIVERY_CLAIM_TTL_MS);
  });

  test("the window outlives more than one tick of the 15-minute delivery cadence", () => {
    // A TTL shorter than the gap between ticks lets a live claim be stolen, and two ticks
    // then post the same finding to the same channel.
    const FIFTEEN_MINUTES_MS = 15 * 60 * 1_000;

    expect(DELIVERY_CLAIM_TTL_MS).toBeGreaterThan(FIFTEEN_MINUTES_MS);
  });

  test("the window is far shorter than the week the delivery budget is measured over", () => {
    // A TTL near the budget window would make an abandoned claim indistinguishable from a
    // deliberate silence for most of the week it blocks.
    const A_WEEK_MS = 7 * 24 * 60 * 60 * 1_000;

    expect(DELIVERY_CLAIM_TTL_MS).toBeLessThan(A_WEEK_MS / 10);
  });

  test("it does not mutate the date it is given", () => {
    const at = new Date(AT);
    deliveryClaimsExpireBefore(at);

    expect(at.getTime()).toBe(AT.getTime());
  });
});

function weighted(role: SurfaceRole, surface: string) {
  return surfaceWorth({ surface, role, basis: "stated_by_customer", confirmedAt: null });
}

describe("compareDeliveryCandidates, ranking by expected value", () => {
  test("should prefer the surface that is worth more when the counts are equal", () => {
    const decision = decideDelivery(
      lane({
        candidates: [
          candidate({ findingId: "f-settings", worth: unknownWorth("/settings") }),
          candidate({ findingId: "f-checkout", worth: weighted("makes_money", "/checkout") }),
        ],
      }),
      NOW,
    );

    expect(decision).toMatchObject({ finding: { findingId: "f-checkout" } });
  });

  test("should prefer a smaller count on a surface that is worth more", () => {
    // §6: rage clicks on a settings page nobody monetises are not the top item.
    const decision = decideDelivery(
      lane({
        candidates: [
          candidate({
            findingId: "f-many-on-settings",
            sampleSize: { numerator: 40, denominator: 400 },
            worth: unknownWorth("/settings"),
          }),
          candidate({
            findingId: "f-few-on-checkout",
            sampleSize: { numerator: 9, denominator: 90 },
            worth: weighted("makes_money", "/checkout"),
          }),
        ],
      }),
      NOW,
    );

    expect(decision).toMatchObject({ finding: { findingId: "f-few-on-checkout" } });
  });

  test("should never let worth outrank stronger evidence", () => {
    // Expected value sits behind confidence, never in front of it: §6 also refuses a call
    // the evidence cannot support.
    const decision = decideDelivery(
      lane({
        candidates: [
          candidate({
            findingId: "f-checkout-weak",
            confidenceBasis: "at_threshold",
            sampleSize: { numerator: 100, denominator: 1_000 },
            worth: weighted("makes_money", "/checkout"),
          }),
          candidate({
            findingId: "f-settings-proven",
            confidenceBasis: "threshold_met",
            sampleSize: { numerator: 2, denominator: 20 },
            worth: unknownWorth("/settings"),
          }),
        ],
      }),
      NOW,
    );

    expect(decision).toMatchObject({ finding: { findingId: "f-settings-proven" } });
  });

  test("should rank on sessions affected when no surface has been roled", () => {
    // The absence path every organisation is on until a growth context exists. Ranking is
    // by who was hurt, not by which surface was busiest.
    const decision = decideDelivery(
      lane({
        candidates: [
          candidate({
            findingId: "f-busy-surface",
            sampleSize: { numerator: 10, denominator: 5_000 },
            worth: unknownWorth("/a"),
          }),
          candidate({
            findingId: "f-more-affected",
            sampleSize: { numerator: 60, denominator: 200 },
            worth: unknownWorth("/b"),
          }),
        ],
      }),
      NOW,
    );

    expect(decision).toMatchObject({ finding: { findingId: "f-more-affected" } });
  });

  test("should fall through to the denominator when expected values are equal", () => {
    const bigger = candidate({
      findingId: "f-bigger-sample",
      sampleSize: { numerator: 10, denominator: 500 },
      worth: unknownWorth("/a"),
    });
    const smaller = candidate({
      findingId: "f-smaller-sample",
      sampleSize: { numerator: 10, denominator: 100 },
      worth: unknownWorth("/b"),
    });

    expect(compareDeliveryCandidates(bigger, smaller)).toBeLessThan(0);
    expect(compareDeliveryCandidates(smaller, bigger)).toBeGreaterThan(0);
  });

  test("should stay total: two identical candidates order by finding id", () => {
    const a = candidate({ findingId: "f-a", worth: unknownWorth("/x") });
    const b = candidate({ findingId: "f-b", worth: unknownWorth("/x") });

    expect(compareDeliveryCandidates(a, b)).toBeLessThan(0);
    expect(compareDeliveryCandidates(a, a)).toBe(0);
  });

  test("should choose the same candidate for every permutation once worth is in play", () => {
    const candidates = [
      candidate({
        findingId: "f-checkout",
        sampleSize: { numerator: 9, denominator: 90 },
        worth: weighted("makes_money", "/checkout"),
      }),
      candidate({
        findingId: "f-welcome",
        sampleSize: { numerator: 11, denominator: 110 },
        worth: weighted("first_value", "/welcome"),
      }),
      candidate({
        findingId: "f-settings",
        sampleSize: { numerator: 40, denominator: 400 },
        worth: unknownWorth("/settings"),
      }),
    ];

    const chosen = new Set(
      permutations(candidates).map((ordering) => {
        const decision = decideDelivery(lane({ candidates: ordering }), NOW);
        return decision.decision === "deliver" ? decision.finding.findingId : decision.reason;
      }),
    );

    expect([...chosen]).toEqual(["f-checkout"]);
  });
});

describe("silence is only readable against the cadence that produces it", () => {
  const AT = new Date("2026-08-02T09:00:00.000Z");

  test("a lease is two ticks, derived rather than restated", () => {
    expect(DELIVERY_CLAIM_TTL_MS).toBe(2 * DELIVERY_TICK_INTERVAL_MS);
  });

  test("counts the ticks a lane has gone without deciding anything", () => {
    const after = (ms: number): Date => new Date(AT.getTime() + ms);

    expect(deliveryTicksSince(AT, AT)).toBe(0);
    expect(deliveryTicksSince(AT, after(DELIVERY_TICK_INTERVAL_MS - 1))).toBe(0);
    expect(deliveryTicksSince(AT, after(DELIVERY_TICK_INTERVAL_MS))).toBe(1);
    expect(deliveryTicksSince(AT, after(3 * DELIVERY_TICK_INTERVAL_MS))).toBe(3);
  });

  test("a decision stamped ahead of the clock reads as current, never as negative silence", () => {
    // Worker and web can disagree by seconds. Clamping at zero keeps a skewed clock from
    // reporting a lane as fresher or staler than any threshold a reader applies.
    expect(deliveryTicksSince(new Date(AT.getTime() + 60_000), AT)).toBe(0);
    expect(deliverySilenceMs(new Date(AT.getTime() + 60_000), AT)).toBe(0);
  });

  test("a threshold held as a duration survives a change of cadence, one held as ticks does not", () => {
    // The bug this pair exists to prevent: "3 ticks" meant three hours against an assumed
    // hourly cadence and forty-five minutes against the real one. A window stated in minutes
    // means the same thing whatever the schedule does.
    const TWO_HOURS_MS = 2 * 60 * 60 * 1_000;
    const silence = deliverySilenceMs(AT, new Date(AT.getTime() + TWO_HOURS_MS));

    expect(silence).toBe(TWO_HOURS_MS);
    expect(silence >= TWO_HOURS_MS).toBe(true);

    // The same window, counted against today's cadence, for copy that names the schedule.
    expect(deliveryTicksSince(AT, new Date(AT.getTime() + TWO_HOURS_MS))).toBe(
      TWO_HOURS_MS / DELIVERY_TICK_INTERVAL_MS,
    );
  });
});
