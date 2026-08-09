import { EXCLUSION_REASON_LABELS, FLOOR_NO_RATE_TEMPLATE } from "@growthmind/shared";
import type { ExclusionReason } from "@growthmind/shared";
import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";
import { z } from "zod";

import {
  COUNT_UNITS,
  isMeasuredCount,
  measuredCount,
  measuredCountInputSchema,
  measuredCountSchema,
  rateOf,
} from "../../src/counts/measured-count";
import type {
  CountBasis,
  MeasuredCount,
  MeasuredCountInput,
  SetAsideBasis,
} from "../../src/counts/measured-count";
import { renderCountSentence } from "../../src/delivery/slack-message";
import type { DeliveryVocabulary, Observation } from "../../src/delivery/slack-message";
import type { DetectorCoverage } from "../../src/detect/types";
import { instrumentationProofSatisfied } from "../../src/evidence/predicates";
import type { EvidenceSignal } from "../../src/evidence/signals";
import { traceEntry } from "../../src/evidence/trace";
import { candidateFindingSchema } from "../../src/findings/candidate";
import { renderFixSpec } from "../../src/fixes/fix-spec";
import { THRESHOLD_RULE_SETS } from "../../src/rules/thresholds";
import type { ThresholdRuleSet } from "../../src/rules/types";
import { noRateForIdentity } from "../../src/shipped/counts";

const FIXTURE_WINDOW = {
  start: new Date("2026-06-01T00:00:00.000Z"),
  end: new Date("2026-06-08T00:00:00.000Z"),
} as const;

function setAside(reason: ExclusionReason, count: number): SetAsideBasis {
  return { reason, count, label: EXCLUSION_REASON_LABELS[reason] };
}

const KEPT_BASIS: CountBasis = {
  totalInWindow: 40,
  kept: 28,
  keptUnchecked: 0,
  setAside: [setAside("automation_known_agent", 9), setAside("internal_domain", 3)],
};

const ALL_SET_ASIDE_BASIS: CountBasis = {
  totalInWindow: 40,
  kept: 0,
  keptUnchecked: 0,
  setAside: [setAside("automation_headless", 31), setAside("internal_domain", 9)],
};

const NOTHING_SET_ASIDE_BASIS: CountBasis = {
  totalInWindow: 28,
  kept: 28,
  keptUnchecked: 0,
  setAside: [],
};

const INCONSISTENT_BASIS: CountBasis = {
  totalInWindow: 40,
  kept: 28,
  keptUnchecked: 0,
  setAside: [setAside("internal_domain", 3)],
};

function inputOf(params: {
  readonly numerator: number;
  readonly denominator: number;
  readonly timeframe: { readonly start: Date; readonly end: Date };
  readonly basis: CountBasis;
}): MeasuredCountInput {
  return {
    numerator: params.numerator,
    denominator: params.denominator,
    unit: "sessions",
    timeframe: params.timeframe,
    basis: params.basis,
  };
}

const NOT_IMPLEMENTED = "not implemented";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rejectionOf(build: () => unknown): unknown {
  let caught: unknown;
  let threw = false;
  try {
    build();
  } catch (error) {
    caught = error;
    threw = true;
  }

  expect(threw).toBe(true);
  expect(messageOf(caught)).not.toBe(NOT_IMPLEMENTED);
  return caught;
}

function issuePaths(error: unknown): readonly string[] {
  expect(error).toBeInstanceOf(z.ZodError);
  const zodError = error as z.ZodError;
  return zodError.issues.map((issue) => issue.path.join("."));
}

const REPO = new URL("../../../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const COUNTS_PEOPLE = /unit:\s*"people"/;

// Every place in the tree that builds a MeasuredCount. The widening is only safe if it moved
// nothing: repeat is the one count in people, and it lives on the readout path.
function sourcesUnderCount(): readonly string[] {
  const roots = ["packages/core/src", "packages/db/src", "worker/src"] as const;
  const found: string[] = [];

  for (const root of roots) {
    for (const entry of new Bun.Glob("**/*.ts").scanSync({ cwd: `${REPO}/${root}` })) {
      found.push(`${root}/${entry.replaceAll("\\", "/")}`);
    }
  }

  return found.toSorted().map((file) => `${REPO}/${file}`);
}

describe("MeasuredCount", () => {
  test("should reject construction when denominator is missing", () => {
    const withoutDenominator: Omit<MeasuredCountInput, "denominator"> = {
      numerator: 3,
      unit: "sessions",
      timeframe: FIXTURE_WINDOW,
      basis: KEPT_BASIS,
    };

    expect(measuredCountInputSchema.safeParse(withoutDenominator).success).toBe(false);

    const refusal = rejectionOf(() =>
      // @ts-expect-error —: `denominator` is required; omitting it is a compile error.
      measuredCount(withoutDenominator),
    );
    expect(issuePaths(refusal)).toContain("denominator");
  });

  test("should reject a negative denominator", () => {
    const refusal = rejectionOf(() =>
      measuredCount(
        inputOf({
          numerator: 0,
          denominator: -1,
          timeframe: FIXTURE_WINDOW,
          basis: NOTHING_SET_ASIDE_BASIS,
        }),
      ),
    );

    expect(issuePaths(refusal)).toContain("denominator");
  });

  test("should reject a negative numerator", () => {
    const refusal = rejectionOf(() =>
      measuredCount(
        inputOf({
          numerator: -1,
          denominator: 28,
          timeframe: FIXTURE_WINDOW,
          basis: NOTHING_SET_ASIDE_BASIS,
        }),
      ),
    );

    expect(issuePaths(refusal)).toContain("numerator");
  });

  test("should reject a numerator larger than its denominator", () => {
    const refusal = rejectionOf(() =>
      measuredCount(
        inputOf({
          numerator: 35,
          denominator: 28,
          timeframe: FIXTURE_WINDOW,
          basis: NOTHING_SET_ASIDE_BASIS,
        }),
      ),
    );

    expect(issuePaths(refusal)).toContain("numerator");

    const everySessionDropped = measuredCount(
      inputOf({
        numerator: 28,
        denominator: 28,
        timeframe: FIXTURE_WINDOW,
        basis: NOTHING_SET_ASIDE_BASIS,
      }),
    );

    expect(everySessionDropped.numerator).toBe(28);
    expect(rateOf(everySessionDropped)).toEqual({ kind: "rate", value: 1 });
  });

  test("should represent a zero denominator and return no_rate, never NaN or Infinity", () => {
    const count = measuredCount(
      inputOf({
        numerator: 0,
        denominator: 0,
        timeframe: FIXTURE_WINDOW,
        basis: ALL_SET_ASIDE_BASIS,
      }),
    );

    expect(count.basis.totalInWindow).toBe(40);
    expect(count.denominator).toBe(0);

    const rate = rateOf(count);

    expect(rate).toEqual({ kind: "no_rate", reason: "zero_denominator" });
    expect(Object.values(rate).some((field) => typeof field === "number")).toBe(false);
  });

  test("should return a rate when the denominator is positive", () => {
    const count = measuredCount(
      inputOf({
        numerator: 3,
        denominator: 28,
        timeframe: FIXTURE_WINDOW,
        basis: KEPT_BASIS,
      }),
    );

    const rate = rateOf(count);

    expect(rate).toEqual({ kind: "rate", value: 3 / 28 });
    if (rate.kind !== "rate") {
      throw new Error(`expected a rate, received ${rate.kind}`);
    }
    expect(Number.isFinite(rate.value)).toBe(true);
    expect(rate.value).toBeGreaterThan(0);
    expect(rate.value).toBeLessThan(1);
  });

  test("should widen the count unit without moving any existing count", () => {
    const inSessions = measuredCount(
      inputOf({
        numerator: 3,
        denominator: 28,
        timeframe: FIXTURE_WINDOW,
        basis: KEPT_BASIS,
      }),
    );

    expect(inSessions.unit).toBe("sessions");

    // Repeat counts people, so the unit widens by exactly one member — one field on the same
    // type, never a forked count.
    expect([...COUNT_UNITS].toSorted()).toEqual(["people", "sessions"]);

    const inPeople = measuredCount({
      numerator: 2,
      denominator: 28,
      unit: "people",
      timeframe: FIXTURE_WINDOW,
      basis: KEPT_BASIS,
    });

    expect(inPeople.unit).toBe("people");

    const inVisits: MeasuredCountInput = {
      numerator: 3,
      denominator: 28,
      // @ts-expect-error —: the unit is exactly two members wide; a third is a compile error.
      unit: "visits",
      timeframe: FIXTURE_WINDOW,
      basis: KEPT_BASIS,
    };

    expect(measuredCountInputSchema.safeParse(inVisits).success).toBe(false);
    expect(issuePaths(rejectionOf(() => measuredCount(inVisits)))).toContain("unit");
  });

  test("should leave every count outside the readout path counting sessions", () => {
    const scanned = sourcesUnderCount();
    const inPeople = scanned.filter((file) => COUNTS_PEOPLE.test(readFileSync(file, "utf8")));

    expect(scanned.length).toBeGreaterThan(0);
    expect(inPeople.filter((file) => !file.includes("/shipped/"))).toEqual([]);
  });

  test("should assert the basis identity kept + sum(setAside) === totalInWindow", () => {
    const count = measuredCount(
      inputOf({
        numerator: 3,
        denominator: 28,
        timeframe: FIXTURE_WINDOW,
        basis: KEPT_BASIS,
      }),
    );

    const setAsideTotal = count.basis.setAside.reduce((sum, row) => sum + row.count, 0);
    expect(count.basis.kept + setAsideTotal).toBe(count.basis.totalInWindow);

    expect(count.denominator).toBe(count.basis.kept);

    rejectionOf(() =>
      measuredCount(
        inputOf({
          numerator: 3,
          denominator: 28,
          timeframe: FIXTURE_WINDOW,
          basis: INCONSISTENT_BASIS,
        }),
      ),
    );

    rejectionOf(() =>
      measuredCount(
        inputOf({
          numerator: 3,
          denominator: 27,
          timeframe: FIXTURE_WINDOW,
          basis: KEPT_BASIS,
        }),
      ),
    );
  });

  test("should be unconstructible without the smart constructor (brand)", () => {
    const lookalike: MeasuredCountInput = inputOf({
      numerator: 3,
      denominator: 28,
      timeframe: FIXTURE_WINDOW,
      basis: KEPT_BASIS,
    });

    expect(isMeasuredCount(lookalike)).toBe(false);
    expect(measuredCountSchema.safeParse(lookalike).success).toBe(false);

    // @ts-expect-error —: the brand key is module-private, so no literal is assignable.
    const unbranded: MeasuredCount = lookalike;
    expect(isMeasuredCount(unbranded)).toBe(false);

    const constructed = measuredCount(lookalike);
    expect(isMeasuredCount(constructed)).toBe(true);
    expect(measuredCountSchema.safeParse(constructed).success).toBe(true);
  });
});

function countOf(numerator: number, denominator: number, basis: CountBasis): MeasuredCount {
  return measuredCount(inputOf({ numerator, denominator, timeframe: FIXTURE_WINDOW, basis }));
}

function codomainOf(counts: readonly MeasuredCount[]): readonly string[] {
  const seen = new Set(
    counts.map((count) => {
      const rate = rateOf(count);
      return rate.kind === "no_rate" ? `no_rate:${rate.reason}` : "rate";
    }),
  );

  return [...seen].toSorted();
}

describe("rateOf's codomain is what lets the three arity call sites collapse", () => {
  test("should never return a no_rate reason other than zero_denominator from rateOf", () => {
    const counts: readonly MeasuredCount[] = [
      countOf(0, 0, ALL_SET_ASIDE_BASIS),
      countOf(0, 28, KEPT_BASIS),
      countOf(1, 28, KEPT_BASIS),
      countOf(27, 28, KEPT_BASIS),
      countOf(28, 28, KEPT_BASIS),
      countOf(0, 28, NOTHING_SET_ASIDE_BASIS),
      measuredCount({
        numerator: 2,
        denominator: 28,
        unit: "people",
        timeframe: FIXTURE_WINDOW,
        basis: KEPT_BASIS,
      }),
    ];

    // Zero, boundary and full denominators, and both units. An empty list would agree with
    // anything, so the population is asserted first.
    expect(counts.length).toBeGreaterThan(0);
    expect(codomainOf(counts)).toEqual(["no_rate:zero_denominator", "rate"]);
  });

  test("should reach the identity reason only through its own constructor", () => {
    expect(noRateForIdentity()).toEqual({ kind: "no_rate", reason: "no_identity_coverage" });

    // The day a later outcome routes this reason through rateOf, the codomain test above is
    // where it goes red — and that is the whole reason the three call sites need no edit.
    expect(rateOf(countOf(0, 0, ALL_SET_ASIDE_BASIS))).not.toEqual(noRateForIdentity());
  });
});

const NO_RATE_VOCABULARY: DeliveryVocabulary = {
  nothingTodayLead:
    "We looked at what happened in your product, and we are not sending you anything today.",
  nothingToday: {
    one_already_open: "The last thing we sent is still waiting on an answer.",
    no_findings_ready: "We checked what happened and nothing was solid enough to send yet.",
    budget_spent: "We have already sent everything we will send for now.",
  },
  noRate: "Every session we looked at was set aside, so there is no share to report.",
};

const CLEAN_COVERAGE: DetectorCoverage = { truncated: false, eventsWithoutUrlPath: 0 };

const NO_RATE_SURFACE = "/reports";

function ruleSetV1(): ThresholdRuleSet {
  const rules = THRESHOLD_RULE_SETS.get(1);
  if (!rules) throw new Error("threshold rule set version 1 must remain resolvable forever");
  return rules;
}

function emptyWindowFixSpecSentences(): readonly string[] {
  const candidate = candidateFindingSchema.parse({
    detector: "error_event",
    claimedClass: "instrumentation",
    finalClass: "instrumentation",
    trace: [
      traceEntry({
        class: "instrumentation",
        predicate: "instrumentation_o053",
        predicateVersion: 1,
        satisfied: true,
      }),
    ],
    counts: [countOf(0, 0, ALL_SET_ASIDE_BASIS)],
    timeframe: FIXTURE_WINDOW,
    claimSubject: "surface",
    surface: NO_RATE_SURFACE,
    surfaceNormalisationVersion: 1,
    evidenceShape: "o053-empty-window",
    evidenceShapeVersion: 1,
    thresholdRuleSetVersion: 1,
    ranking: { sampleSize: countOf(0, 0, ALL_SET_ASIDE_BASIS), confidenceBasis: "below_threshold" },
    coverage: CLEAN_COVERAGE,
  });

  return renderFixSpec({ candidate, signals: [] }).measurement;
}

describe("Decision 6g — the three named call sites are verified, not edited", () => {
  test("should leave the finding no-rate sentence unmoved for a zero_denominator rate", () => {
    const emptyWindow = countOf(0, 0, ALL_SET_ASIDE_BASIS);
    expect(rateOf(emptyWindow)).toEqual({ kind: "no_rate", reason: "zero_denominator" });

    const observation: Observation = { label: "left without going anywhere", count: emptyWindow };

    expect(renderCountSentence(observation, NO_RATE_VOCABULARY)).toBe(NO_RATE_VOCABULARY.noRate);
  });

  test("should leave the instrumentation predicate claiming no drop for a rate it cannot compute", () => {
    const noObservedWindow: EvidenceSignal = {
      kind: "instrumentation_rate_drop",
      eventName: "checkout_completed",
      observed: countOf(0, 0, ALL_SET_ASIDE_BASIS),
      expected: countOf(1, 28, KEPT_BASIS),
    };

    expect(instrumentationProofSatisfied([noObservedWindow], ruleSetV1())).toBe(false);
  });

  test("should leave the fix-spec no-rate template rendering for a zero_denominator rate", () => {
    const measurement = emptyWindowFixSpecSentences();

    expect(measurement.length).toBeGreaterThan(0);
    expect(measurement).toContain(FLOOR_NO_RATE_TEMPLATE);
  });
});
