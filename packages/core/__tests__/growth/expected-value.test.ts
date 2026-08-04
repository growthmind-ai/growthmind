import { describe, expect, test } from "bun:test";

import { measuredCount } from "../../src/counts/measured-count";
import {
  compareExpectedValue,
  expectedValueOf,
  expectedValueOfCount,
} from "../../src/growth/expected-value";
import { surfaceWorth, unknownWorth, weightOfRole } from "../../src/growth/surface-worth";
import type { SurfaceRole } from "../../src/growth/surface-worth";

const WINDOW = {
  start: new Date("2026-07-24T00:00:00.000Z"),
  end: new Date("2026-07-31T00:00:00.000Z"),
};

function worthOfRole(role: SurfaceRole, surface = "/checkout") {
  return surfaceWorth({ surface, role, basis: "stated_by_customer", confirmedAt: null });
}

function count(numerator: number, denominator: number) {
  return measuredCount({
    numerator,
    denominator,
    unit: "sessions",
    timeframe: WINDOW,
    basis: { totalInWindow: denominator, kept: denominator, setAside: [] },
  });
}

describe("expectedValueOf", () => {
  test("reduces to the affected count when nothing has been said about the surface", () => {
    const value = expectedValueOf(37, unknownWorth("/dashboard"));

    expect(value.score).toBe(37);
    expect(value.affected).toBe(37);
    expect(value.weight).toBe(1);
    expect(value.role).toBe("unknown");
  });

  test("multiplies the affected count by the role's weight", () => {
    const value = expectedValueOf(10, worthOfRole("makes_money"));

    expect(value.score).toBe(10 * weightOfRole("makes_money"));
  });

  test("is zero when nobody was affected, whatever the surface is worth", () => {
    expect(expectedValueOf(0, worthOfRole("makes_money")).score).toBe(0);
  });

  test("carries the weight version that produced it", () => {
    const worth = worthOfRole("first_value");

    expect(expectedValueOf(5, worth).weightVersion).toBe(worth.weightVersion);
  });

  test("a small count on a weighted surface can outrank a larger one on an unweighted surface", () => {
    // §6's rule in one assertion: rage clicks on a page nobody monetises are not the top
    // item, even when there are more of them.
    const weighted = expectedValueOf(20, worthOfRole("makes_money"));
    const plain = expectedValueOf(100, unknownWorth("/settings"));

    expect(compareExpectedValue(weighted, plain)).toBeLessThan(0);
  });

  test("a large enough count still outranks a weighted surface", () => {
    const weighted = expectedValueOf(20, worthOfRole("makes_money"));
    const plain = expectedValueOf(1_000, unknownWorth("/settings"));

    expect(compareExpectedValue(weighted, plain)).toBeGreaterThan(0);
  });
});

describe("expectedValueOfCount", () => {
  test("ranks on sessions affected, not on the rate", () => {
    // Same rate, different traffic. The busier surface is worth more to fix.
    const busy = expectedValueOfCount(count(100, 1_000), unknownWorth("/a"));
    const quiet = expectedValueOfCount(count(10, 100), unknownWorth("/b"));

    expect(compareExpectedValue(busy, quiet)).toBeLessThan(0);
  });

  test("a zero denominator is a zero score rather than a throw", () => {
    expect(expectedValueOfCount(count(0, 0), worthOfRole("makes_money")).score).toBe(0);
  });
});

describe("compareExpectedValue", () => {
  test("orders higher scores first", () => {
    const high = expectedValueOf(10, worthOfRole("makes_money"));
    const low = expectedValueOf(10, unknownWorth("/settings"));

    expect(compareExpectedValue(high, low)).toBeLessThan(0);
    expect(compareExpectedValue(low, high)).toBeGreaterThan(0);
  });

  test("reports equal scores as equal, so the caller's own tiebreak decides", () => {
    const viaWeight = expectedValueOf(1, worthOfRole("makes_money"));
    const viaCount = expectedValueOf(weightOfRole("makes_money"), unknownWorth("/settings"));

    expect(viaWeight.score).toBe(viaCount.score);
    expect(compareExpectedValue(viaWeight, viaCount)).toBe(0);
  });
});
