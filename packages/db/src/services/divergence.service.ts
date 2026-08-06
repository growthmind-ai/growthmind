import {
  computeDivergence,
  sampleSessionIds,
  surfaceNormalisationVersionOf,
  DIVERGENCE_ANCHOR_SESSION_LIMIT,
  DIVERGENCE_COHORT_MATCH_VERSION,
  STEP_SPINE_VERSION,
  type AnalysisWindow,
  type DivergenceResult,
  type SessionTimeline,
} from "@growthmind/core";
import type { TenantContext } from "@growthmind/shared";

import {
  createDivergencePointsRepo,
  type DivergencePointRecord,
  type RecordDivergenceInput,
} from "../repositories/divergence-points.repo";
import type { ScopedDb } from "../repositories/types";

export interface RecordDivergenceServiceInput {
  readonly projectId: string;
  readonly surface: string;
  readonly window: AnalysisWindow;
  readonly succeeded: readonly SessionTimeline[];
  readonly failed: readonly SessionTimeline[];
}

export interface RecordDivergenceServiceResult {
  readonly result: DivergenceResult;
  readonly record: DivergencePointRecord;
}

export interface DivergenceService {
  recordDivergence(input: RecordDivergenceServiceInput): Promise<RecordDivergenceServiceResult>;
}

function toRepoOutcome(
  result: DivergenceResult,
): Pick<RecordDivergenceInput, "kind" | "divergedAtRank" | "reason"> {
  if (result.kind === "diverged") {
    return { kind: "diverged", divergedAtRank: result.rank, reason: null };
  }

  return { kind: result.kind, divergedAtRank: null, reason: result.reason };
}

export function createDivergenceService(db: ScopedDb, ctx: TenantContext): DivergenceService {
  const repo = createDivergencePointsRepo(db, ctx);

  return {
    async recordDivergence(
      input: RecordDivergenceServiceInput,
    ): Promise<RecordDivergenceServiceResult> {
      const result = computeDivergence({
        surface: input.surface,
        succeeded: input.succeeded,
        failed: input.failed,
      });

      const allSessions = input.succeeded.concat(input.failed);

      const record = await repo.recordDivergence({
        ...toRepoOutcome(result),
        projectId: input.projectId,
        surface: input.surface,
        surfaceNormalisationVersion: surfaceNormalisationVersionOf(allSessions, input.surface),
        spineVersion: STEP_SPINE_VERSION,
        cohortMatchVersion: DIVERGENCE_COHORT_MATCH_VERSION,
        windowStart: input.window.start,
        windowEnd: input.window.end,
        succeededCohortSize: input.succeeded.length,
        failedCohortSize: input.failed.length,
        succeededSessionIdsSample: sampleSessionIds(
          input.succeeded,
          DIVERGENCE_ANCHOR_SESSION_LIMIT,
        ),
        failedSessionIdsSample: sampleSessionIds(input.failed, DIVERGENCE_ANCHOR_SESSION_LIMIT),
      });

      return { result, record };
    },
  };
}
