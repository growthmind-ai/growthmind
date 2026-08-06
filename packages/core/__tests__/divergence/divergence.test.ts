import { describe, expect, test } from "bun:test";

import type { SessionTimeline } from "../../src/detect/types";
import { computeDivergence } from "../../src/divergence/divergence";
import type {
  DivergenceCohortInput,
  DivergenceOptions,
  DivergenceResult,
} from "../../src/divergence/types";
import { buildStepSpine, placeOnSpine } from "../../src/spine/spine";
import type { StepSpine } from "../../src/spine/types";
import { sessionOf } from "../spine/fixtures";

const ORIGIN = "/pricing";

function cohort(
  idPrefix: string,
  count: number,
  paths: readonly (string | null)[],
): readonly SessionTimeline[] {
  const sessions: SessionTimeline[] = [];
  for (let index = 0; index < count; index += 1) {
    sessions.push(sessionOf(`${idPrefix}-${String(index)}`, paths));
  }
  return sessions;
}

function stepIndexOf(spine: StepSpine, path: string): number {
  const step = spine.steps.find((candidate) => candidate.path === path);
  if (!step) throw new Error(`fixture bug: "${path}" must be on the spine`);
  return step.index;
}

function hasNonFiniteNumber(value: unknown): boolean {
  if (typeof value === "number") return !Number.isFinite(value);
  if (Array.isArray(value)) return value.some(hasNonFiniteNumber);
  if (value !== null && typeof value === "object") {
    return Object.values(value).some(hasNonFiniteNumber);
  }
  return false;
}

describe("computeDivergence — one shared spine (FR-1)", () => {
  test("should place both cohorts on the identical StepSpine object when computing divergence", () => {
    const succeeded = cohort("succ", 5, [ORIGIN, "/plan", "/checkout"]);
    const failed = cohort("fail", 5, [ORIGIN, "/plan"]);

    const sharedSpine = buildStepSpine([...succeeded, ...failed], ORIGIN, {
      minReachRatioPercent: 0,
    });
    const succeededPlacements = placeOnSpine(sharedSpine, succeeded);
    const failedPlacements = placeOnSpine(sharedSpine, failed);
    const checkoutIndex = stepIndexOf(sharedSpine, "/checkout");

    // A divergence answer at the checkout rank is only possible if both cohorts
    // read it off the same spine object (FR-1) — placed on two independently
    // built spines, "/checkout" would not necessarily land at the same index.
    expect(succeededPlacements.every((p) => p.visitedIndexes.includes(checkoutIndex))).toBe(true);
    expect(failedPlacements.every((p) => !p.visitedIndexes.includes(checkoutIndex))).toBe(true);

    const input: DivergenceCohortInput = { surface: ORIGIN, succeeded, failed };
    const options: DivergenceOptions = {
      cohortFloor: 3,
      marginPercent: 20,
      minReachRatioPercent: 0,
    };

    const result: DivergenceResult = computeDivergence(input, options);

    expect(result).toEqual({ kind: "diverged", rank: checkoutIndex });
  });

  test("should not throw when succeeded and failed cohorts visit different downstream paths", () => {
    const succeeded = cohort("succ", 5, [ORIGIN, "/only-succeeded"]);
    const failed = cohort("fail", 5, [ORIGIN, "/only-failed"]);

    const input: DivergenceCohortInput = { surface: ORIGIN, succeeded, failed };
    const options: DivergenceOptions = { cohortFloor: 3, marginPercent: 20 };

    expect(() => computeDivergence(input, options)).not.toThrow();

    const result = computeDivergence(input, options);
    expect(["diverged", "no_divergence", "refused"]).toContain(result.kind);
  });
});

describe("computeDivergence — the first diverging rank, not the deepest (FR-2)", () => {
  test("returns the first rank where the failed cohort's reach rate falls behind the succeeded cohort's, not the deepest rank where any gap exists", () => {
    const succeeded = cohort("succ", 10, [ORIGIN, "/a", "/b", "/c", "/d"]);
    const failed = [
      ...cohort("fail-shallow", 7, [ORIGIN, "/a"]),
      ...cohort("fail-mid", 3, [ORIGIN, "/a", "/b", "/c"]),
    ];

    const oracleSpine = buildStepSpine([...succeeded, ...failed], ORIGIN);
    const rankB = stepIndexOf(oracleSpine, "/b");
    const rankD = stepIndexOf(oracleSpine, "/d");
    expect(rankB).toBeLessThan(rankD);

    const input: DivergenceCohortInput = { surface: ORIGIN, succeeded, failed };
    const options: DivergenceOptions = { cohortFloor: 3, marginPercent: 20 };

    const result = computeDivergence(input, options);

    expect(result).toEqual({ kind: "diverged", rank: rankB });
  });

  test("never reads deepestVisitedIndex when the spine reports branching", () => {
    const succeeded = [
      ...cohort("succ-annual", 3, [ORIGIN, "/annual", "/checkout"]),
      ...cohort("succ-monthly", 2, [ORIGIN, "/monthly", "/checkout"]),
    ];
    // Failed sessions skip the branch rank entirely and land straight on
    // checkout — visitedIndexes has a gap at the branch rank even though
    // deepestVisitedIndex (a max, not a membership test) would call it reached.
    const failed = cohort("fail-direct", 5, [ORIGIN, "/checkout"]);

    const oracleSpine = buildStepSpine([...succeeded, ...failed], ORIGIN, {
      minReachRatioPercent: 0,
    });
    expect(oracleSpine.branching).toBe(true);
    const branchRank = stepIndexOf(oracleSpine, "/annual");
    expect(stepIndexOf(oracleSpine, "/monthly")).toBe(branchRank);

    const failedPlacements = placeOnSpine(oracleSpine, failed);
    for (const placement of failedPlacements) {
      expect(placement.visitedIndexes).not.toContain(branchRank);
      expect(placement.deepestVisitedIndex).toBeGreaterThan(branchRank);
    }

    const input: DivergenceCohortInput = { surface: ORIGIN, succeeded, failed };
    const options: DivergenceOptions = {
      cohortFloor: 3,
      marginPercent: 20,
      minReachRatioPercent: 0,
    };

    const result = computeDivergence(input, options);

    // Reading deepestVisitedIndex >= branchRank as "reached" would count the
    // direct-to-checkout sessions as clearing the branch rank too, erasing this
    // gap and returning no_divergence instead of the diverged answer below.
    expect(result).toEqual({ kind: "diverged", rank: branchRank });
  });
});

describe("computeDivergence — the cohort floor (FR-3)", () => {
  const FLOOR = 5;

  test("refuses when the succeeded cohort is below the floor", () => {
    const succeeded = cohort("succ", FLOOR - 1, [ORIGIN, "/x"]);
    const failed = cohort("fail", 10, [ORIGIN, "/x"]);

    const input: DivergenceCohortInput = { surface: ORIGIN, succeeded, failed };
    const options: DivergenceOptions = { cohortFloor: FLOOR, marginPercent: 20 };

    expect(() => computeDivergence(input, options)).not.toThrow();
    expect(computeDivergence(input, options)).toEqual({
      kind: "refused",
      reason: "cohort_below_floor",
    });
  });

  test("refuses when the failed cohort is below the floor", () => {
    const succeeded = cohort("succ", 10, [ORIGIN, "/x"]);
    const failed = cohort("fail", FLOOR - 1, [ORIGIN, "/x"]);

    const input: DivergenceCohortInput = { surface: ORIGIN, succeeded, failed };
    const options: DivergenceOptions = { cohortFloor: FLOOR, marginPercent: 20 };

    expect(() => computeDivergence(input, options)).not.toThrow();
    expect(computeDivergence(input, options)).toEqual({
      kind: "refused",
      reason: "cohort_below_floor",
    });
  });

  test("proceeds to compare cohorts when both are exactly at the floor", () => {
    const succeeded = cohort("succ", FLOOR, [ORIGIN]);
    const failed = cohort("fail", FLOOR, [ORIGIN]);

    const input: DivergenceCohortInput = { surface: ORIGIN, succeeded, failed };
    const options: DivergenceOptions = { cohortFloor: FLOOR, marginPercent: 20 };

    const result = computeDivergence(input, options);

    expect(result.kind).not.toBe("refused");
  });
});

describe("computeDivergence — boundaries degrade, they do not fabricate (D5/FR-4)", () => {
  function emptySucceededFixture(): { input: DivergenceCohortInput; options: DivergenceOptions } {
    return {
      input: { surface: ORIGIN, succeeded: [], failed: cohort("fail", 5, [ORIGIN, "/x"]) },
      options: { cohortFloor: 0, marginPercent: 20 },
    };
  }

  function singleFailingSessionFixture(): {
    input: DivergenceCohortInput;
    options: DivergenceOptions;
  } {
    return {
      input: {
        surface: ORIGIN,
        succeeded: cohort("succ", 5, [ORIGIN, "/x"]),
        failed: cohort("fail", 1, [ORIGIN, "/x"]),
      },
      options: { cohortFloor: 1, marginPercent: 20 },
    };
  }

  function identicalCohortsFixture(): {
    input: DivergenceCohortInput;
    options: DivergenceOptions;
  } {
    const paths = [ORIGIN, "/a", "/b"];
    return {
      input: {
        surface: ORIGIN,
        succeeded: cohort("succ", 5, paths),
        failed: cohort("fail", 5, paths),
      },
      options: { cohortFloor: 3, marginPercent: 20 },
    };
  }

  function singleRankSpineFixture(): {
    input: DivergenceCohortInput;
    options: DivergenceOptions;
  } {
    return {
      input: {
        surface: ORIGIN,
        succeeded: cohort("succ", 5, [ORIGIN]),
        failed: cohort("fail", 5, [ORIGIN]),
      },
      options: { cohortFloor: 3, marginPercent: 20 },
    };
  }

  test("returns no_divergence rather than NaN when the succeeded cohort is empty", () => {
    const { input, options } = emptySucceededFixture();

    const result = computeDivergence(input, options);

    expect(hasNonFiniteNumber(result)).toBe(false);
    expect(result.kind).toBe("no_divergence");
  });

  test("returns no_divergence for a single failing session", () => {
    const { input, options } = singleFailingSessionFixture();

    const result = computeDivergence(input, options);

    expect(result.kind).toBe("no_divergence");
  });

  test("returns no_divergence with reason identical_cohorts when every rank's reach rate is equal", () => {
    const { input, options } = identicalCohortsFixture();

    const result = computeDivergence(input, options);

    // reason is the implementer's choice between "no_gap_found" and
    // "identical_cohorts" (ADD Decision 3) — asserted on kind only.
    expect(result.kind).toBe("no_divergence");
  });

  test("returns no_divergence with reason single_rank_spine when only the origin rank exists", () => {
    const { input, options } = singleRankSpineFixture();

    const result = computeDivergence(input, options);

    expect(result).toEqual({ kind: "no_divergence", reason: "single_rank_spine" });
  });

  test("never returns a negative or fabricated rank", () => {
    const fixtures = [
      emptySucceededFixture(),
      singleFailingSessionFixture(),
      identicalCohortsFixture(),
      singleRankSpineFixture(),
    ];

    for (const { input, options } of fixtures) {
      const result = computeDivergence(input, options);
      expect(result.kind).not.toBe("diverged");
    }
  });
});
