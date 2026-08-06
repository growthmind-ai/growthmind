import type { SessionTimeline } from "../detect/types";

export type DivergenceResult =
  | { readonly kind: "diverged"; readonly rank: number }
  | {
      readonly kind: "no_divergence";
      readonly reason: "identical_cohorts" | "single_rank_spine" | "no_gap_found";
    }
  | { readonly kind: "refused"; readonly reason: "cohort_below_floor" };

export type DivergenceGrade = "explained" | "described";

export type DivergenceCohortInput = {
  readonly surface: string;
  readonly succeeded: readonly SessionTimeline[];
  readonly failed: readonly SessionTimeline[];
};

export type DivergenceOptions = {
  readonly cohortFloor?: number;
  readonly marginPercent?: number;
  readonly minReachRatioPercent?: number;
};

// Existing floor for a funnel_dropoff candidate's dropped cohort — rules/thresholds.ts
// (funnelMinDropoffSessions).
export const DIVERGENCE_COHORT_FLOOR = 5;

// Half of the existing dropout-rate detection threshold — rules/thresholds.ts
// (funnelDropoffRateThresholdPercent = 40).
export const DIVERGENCE_MARGIN_PERCENT = 20;

// Identity-version for the cohort match strategy: 1 means "matched on entry surface only".
export const DIVERGENCE_COHORT_MATCH_VERSION = 1;

// Storage-sizing cap for the persisted session-id sample, not a trust-bearing threshold.
export const DIVERGENCE_ANCHOR_SESSION_LIMIT = 50;
