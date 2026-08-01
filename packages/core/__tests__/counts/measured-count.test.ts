// Unit tests for counts: the evidence gate's arithmetic floor.
//
// This suite asserts the one property the product's identity rests on: a count in this
// codebase cannot exist without its denominator. Every test below is written against
// the public contract of `packages/core/src/counts/ measured-count.ts`. The exported
// constructor, the exported guard, the exported schemas, and never against anything
// module-private.
//
// Fixture time is injected, always. `Date.now` and `new Date` (no-arg) appear
// nowhere in this file: a time-of-day-dependent test fails at 23:59 and looks exactly
// like a genuine red state.
import { EXCLUSION_REASON_LABELS } from "@growthmind/shared";
import type { ExclusionReason } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";
import { z } from "zod";

import {
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

// -- fixtures

/** The analysis window, injected. Both instants are literals, never a clock. */
const FIXTURE_WINDOW = {
  start: new Date("2026-06-01T00:00:00.000Z"),
  end: new Date("2026-06-08T00:00:00.000Z"),
} as const;

/**
 * A set-aside row in the customer's own words. The label comes from
 * `EXCLUSION_REASON_LABELS`, so this suite reads the same vocabulary renders rather
 * than inventing a second one.
 */
function setAside(reason: ExclusionReason, count: number): SetAsideBasis {
  return { reason, count, label: EXCLUSION_REASON_LABELS[reason] };
}

/**
 * the own sentence, expressible verbatim: "3 of 28 sessions (12 set aside: 9 crawlers,
 * monitors and scripts, 3 your own team)". Identity holds: 28 + 9 + 3 === 40.
 */
const KEPT_BASIS: CountBasis = {
  totalInWindow: 40,
  kept: 28,
  setAside: [setAside("automation_known_agent", 9), setAside("internal_domain", 3)],
};

/**
 * : every session in the window was set aside. `kept = 0` is a real, reportable
 * state, and `totalInWindow = 40` keeps it distinguishable from (nothing arrived
 * at all) by construction. 0 + 31 + 9 === 40.
 */
const ALL_SET_ASIDE_BASIS: CountBasis = {
  totalInWindow: 40,
  kept: 0,
  setAside: [setAside("automation_headless", 31), setAside("internal_domain", 9)],
};

/** No exclusions at all. The simplest consistent basis. 28 + 0 === 28. */
const NOTHING_SET_ASIDE_BASIS: CountBasis = {
  totalInWindow: 28,
  kept: 28,
  setAside: [],
};

/** The identity is violated here: 28 + 3 === 31, not 40. */
const INCONSISTENT_BASIS: CountBasis = {
  totalInWindow: 40,
  kept: 28,
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

// -- rejection helper

/**
 * The scaffold's placeholder throw. A rejection test must never be satisfied by it: "it
 * threw" is not "it refused". Asserting the message is not this string is what makes
 * the Wave 0 red state honest, and it stays load-bearing after Wave 3. A `not
 * implemented` escaping the constructor is always a bug.
 */
const NOT_IMPLEMENTED = "not implemented";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Runs `build`, requires it to have refused, and returns the refusal. */
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

/** The Zod issue paths a refusal reported, as dotted strings. */
function issuePaths(error: unknown): readonly string[] {
  expect(error).toBeInstanceOf(z.ZodError);
  const zodError = error as z.ZodError;
  return zodError.issues.map((issue) => issue.path.join("."));
}

// -- tests

describe("MeasuredCount", () => {
  test("should reject construction when denominator is missing", () => {
    // Primary guard: the compile error. `denominator` is required and non-optional, so
    // a count without one does not typecheck at all.
    const withoutDenominator: Omit<MeasuredCountInput, "denominator"> = {
      numerator: 3,
      unit: "sessions",
      timeframe: FIXTURE_WINDOW,
      basis: KEPT_BASIS,
    };

    // Mirror: the same refusal is observable at runtime, so an untyped caller (a JS
    // consumer, a parsed payload) gets the same answer.
    expect(measuredCountInputSchema.safeParse(withoutDenominator).success).toBe(false);

    const refusal = rejectionOf(() =>
      // @ts-expect-error —: `denominator` is required; omitting it is a compile error.
      measuredCount(withoutDenominator),
    );
    expect(issuePaths(refusal)).toContain("denominator");
  });

  test("should reject a negative denominator", () => {
    // The basis is internally consistent, so the refusal is about the negative value
    // rather than a malformed basis.
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

  // Fail direction: Refuse. Every count here is a subset count. "sessions that did X
  // out of the kept sessions", so a numerator above its denominator is an impossible
  // claim, not a large one. Left unguarded, `rateOf` returns 1.25 and contradicts
  // `Rate`'s own documented [0, 1] range, and "35 of 28 sessions" reaches a founder in
  // Slack.
  //
  // Reachable because two independent paths compute the same fact: `analysedSessions`
  // recomputes kept from the sessions it was handed, while the detectors read
  // `corpus.basis.kept`. The real corpus service keeps them equal; nothing structural
  // forced that, and // will build corpora this constructor has never seen.
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

    // Non-vacuity, and the boundary. `numerator === denominator` is a real state (every
    // kept session dropped) and must still construct, so the guard above is proven to
    // be about the excess and not about equality.
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
    //  /: everything in the window was set aside. This is a state to report,
    // not an error to raise, so it constructs.
    const count = measuredCount(
      inputOf({
        numerator: 0,
        denominator: 0,
        timeframe: FIXTURE_WINDOW,
        basis: ALL_SET_ASIDE_BASIS,
      }),
    );

    // Still distinguishable from (nothing arrived): 40 sessions were seen.
    expect(count.basis.totalInWindow).toBe(40);
    expect(count.denominator).toBe(0);

    const rate = rateOf(count);

    // `toEqual` is exact over own properties: an implementation that smuggled a numeric
    // `value` onto this arm fails here.
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

  test('should carry unit "sessions" and make a people-count unconstructible', () => {
    // Identity stitching does not exist in this product, `identity_key` is a
    // project-salted hash and the `identities` table does not exist. "3 of 40"
    // therefore means 3 of 40 sessions, and the literal type is what makes unable (not
    // merely unlikely) to render it as people.
    const count = measuredCount(
      inputOf({
        numerator: 3,
        denominator: 28,
        timeframe: FIXTURE_WINDOW,
        basis: KEPT_BASIS,
      }),
    );

    expect(count.unit).toBe("sessions");

    const asPeople: MeasuredCountInput = {
      numerator: 3,
      denominator: 28,
      // @ts-expect-error —: `unit` is the literal "sessions"; a people count is a compile error.
      unit: "people",
      timeframe: FIXTURE_WINDOW,
      basis: KEPT_BASIS,
    };

    // The runtime mirror of the same refusal, for an untyped caller.
    expect(measuredCountInputSchema.safeParse(asPeople).success).toBe(false);
    expect(issuePaths(rejectionOf(() => measuredCount(asPeople)))).toContain("unit");
  });

  test("should assert the basis identity kept + sum(setAside) === totalInWindow", () => {
    // /: the denominator IS kept sessions, and its composition ships with the count. A
    // consistent basis constructs and survives intact.
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

    // The denominator is not merely equal by coincidence. The constructor binds it to
    // `basis.kept`, so a count can never quote a denominator its own basis does not
    // account for.
    expect(count.denominator).toBe(count.basis.kept);

    // A basis whose parts do not sum to its whole is refused, never coerced: 28 kept +
    // 3 set aside is not 40 in the window.
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

    // And a denominator that disagrees with `basis.kept` is refused too.
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
    // The brand is a module-private `unique symbol`. A structurally identical object
    // literal carries every field and is still not a MeasuredCount. That is what makes
    // "impossible to construct without a denominator" literal rather than aspirational.
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

    // The constructor is the only door, and what comes through it is branded.
    const constructed = measuredCount(lookalike);
    expect(isMeasuredCount(constructed)).toBe(true);
    expect(measuredCountSchema.safeParse(constructed).success).toBe(true);
  });
});
