import { PERCENT_SCALE } from "../counts/percent";
import { buildStepSpine, placeOnSpine } from "../spine/spine";
import type { SessionPlacement } from "../spine/types";
import type { DivergenceCohortInput, DivergenceOptions, DivergenceResult } from "./types";
import { DIVERGENCE_COHORT_FLOOR, DIVERGENCE_MARGIN_PERCENT } from "./types";

const ORIGIN_RANK = 0;

// A cohort can be empty when the caller lowers cohortFloor below the default
// (the D5 "boundaries degrade" fixtures do this deliberately) — dividing by a
// zero denominator must read as "nobody reached this rank," not NaN.
function reachRateAt(
  placements: readonly SessionPlacement[],
  rank: number,
  denominator: number,
): number {
  if (denominator === 0) return 0;
  const reached = placements.filter((placement) => placement.visitedIndexes.includes(rank)).length;
  return reached / denominator;
}

export function computeDivergence(
  input: DivergenceCohortInput,
  options: DivergenceOptions = {},
): DivergenceResult {
  const floor = options.cohortFloor ?? DIVERGENCE_COHORT_FLOOR;
  if (input.succeeded.length < floor || input.failed.length < floor) {
    return { kind: "refused", reason: "cohort_below_floor" };
  }

  const spine = buildStepSpine(
    [...input.succeeded, ...input.failed],
    input.surface,
    options.minReachRatioPercent === undefined
      ? {}
      : { minReachRatioPercent: options.minReachRatioPercent },
  );

  if (spine.steps.length === 1) {
    return { kind: "no_divergence", reason: "single_rank_spine" };
  }

  const succeededPlacements = placeOnSpine(spine, input.succeeded);
  const failedPlacements = placeOnSpine(spine, input.failed);

  // visitedIndexes (a membership test) is read unconditionally here, never
  // deepestVisitedIndex (a max) — decision 0014 D-4: the latter is unsound on
  // a branching spine, and the former is sound either way, so there is no
  // condition to branch on.
  const rankGaps = spine.steps
    .filter((step) => step.index > ORIGIN_RANK)
    .map((step) => ({
      rank: step.index,
      succeededReachRate: reachRateAt(succeededPlacements, step.index, input.succeeded.length),
      failedReachRate: reachRateAt(failedPlacements, step.index, input.failed.length),
    }));

  // Explicit short-circuit so identical cohorts resolve to their own reason
  // even when marginPercent is configured to 0, where the margin comparison
  // below would otherwise still (correctly, but ambiguously) call it diverged.
  const allRanksIdentical = rankGaps.every(
    (gap) => gap.succeededReachRate === gap.failedReachRate,
  );
  if (allRanksIdentical) {
    return { kind: "no_divergence", reason: "identical_cohorts" };
  }

  const margin = options.marginPercent ?? DIVERGENCE_MARGIN_PERCENT;
  const diverged = rankGaps.find(
    (gap) => gap.succeededReachRate - gap.failedReachRate >= margin / PERCENT_SCALE,
  );
  if (diverged) {
    return { kind: "diverged", rank: diverged.rank };
  }

  return { kind: "no_divergence", reason: "no_gap_found" };
}
