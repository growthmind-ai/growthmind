import { describe, expect, test } from "bun:test";

import { gradeOf } from "../../src/divergence/grade";
import type { DivergenceResult } from "../../src/divergence/types";

describe("gradeOf — the promotion guard (FR-5)", () => {
  test("a refused-by-floor result can never be graded explained", () => {
    const result: DivergenceResult = { kind: "refused", reason: "cohort_below_floor" };

    expect(gradeOf(result)).toBe("described");
  });

  test("a no-divergence result can never be graded explained", () => {
    const reasons = ["identical_cohorts", "single_rank_spine", "no_gap_found"] as const;

    for (const reason of reasons) {
      const result: DivergenceResult = { kind: "no_divergence", reason };

      expect(gradeOf(result)).toBe("described");
    }
  });

  test("a diverged result is graded explained", () => {
    const result: DivergenceResult = { kind: "diverged", rank: 3 };

    expect(gradeOf(result)).toBe("explained");
  });
});
