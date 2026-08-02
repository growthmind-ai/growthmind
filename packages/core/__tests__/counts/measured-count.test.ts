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
  setAside: [setAside("automation_known_agent", 9), setAside("internal_domain", 3)],
};

const ALL_SET_ASIDE_BASIS: CountBasis = {
  totalInWindow: 40,
  kept: 0,
  setAside: [setAside("automation_headless", 31), setAside("internal_domain", 9)],
};

const NOTHING_SET_ASIDE_BASIS: CountBasis = {
  totalInWindow: 28,
  kept: 28,
  setAside: [],
};

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

  test('should carry unit "sessions" and make a people-count unconstructible', () => {
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

    expect(measuredCountInputSchema.safeParse(asPeople).success).toBe(false);
    expect(issuePaths(rejectionOf(() => measuredCount(asPeople)))).toContain("unit");
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
