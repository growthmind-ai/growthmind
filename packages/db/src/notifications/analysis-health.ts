import {
  ANALYSIS_FAILING_RUN_COUNT,
  ANALYSIS_HEALTH_ALERT_COOLDOWN_SECONDS,
} from "@growthmind/core";
import { buildAnalysisFailingDedupKey, logger, type TenantContext } from "@growthmind/shared";

import { createAnalysisRunsRepo } from "../repositories/analysis-runs.repo";
import { describeDriverError } from "../repositories/driver-error";
import type { ScopedExecutor } from "../repositories/types";
import { emitNotification } from "./emit";

export interface EmitAnalysisFailingInput {
  readonly projectId: string;

  // The run that tripped the detector; part of the dedup key so a later trip on the same
  // project is a new fact rather than a conflict.
  readonly runId: string;
}

// Shared by close() and reclaimAbandonedRun (ADD §4.3). The whole body is log-and-continue:
// `closeRun`'s caller swallows a close failure, so a throwing read here would turn a
// swallowed close into a thrown tick (FR-9 req 4, D8). The emit itself never throws.
export async function emitAnalysisFailingIfDue(
  db: ScopedExecutor,
  ctx: TenantContext,
  input: EmitAnalysisFailingInput,
): Promise<void> {
  try {
    const statuses = await createAnalysisRunsRepo(db, ctx).recentTerminalStatuses(
      input.projectId,
      ANALYSIS_FAILING_RUN_COUNT,
    );

    // The under-alert direction (D10): fewer than N terminal runs, or any one of them not
    // failed, says nothing.
    if (statuses.length < ANALYSIS_FAILING_RUN_COUNT) {
      return;
    }
    if (!statuses.every((status) => status === "failed")) {
      return;
    }

    await emitNotification(db, ctx.organizationId, {
      type: "analysis_failing",
      subjectKind: "project",
      subjectId: input.projectId,
      actorUserId: null,
      payload: { type: "analysis_failing", v: 1 },
      dedupKey: buildAnalysisFailingDedupKey(input.projectId, input.runId),
      slack: { kind: "owed" },
      cooldownSeconds: ANALYSIS_HEALTH_ALERT_COOLDOWN_SECONDS,
    });
  } catch (error) {
    logger.error("notifications: the analysis health read failed, so nobody was told", {
      organizationId: ctx.organizationId,
      projectId: input.projectId,
      reason: describeDriverError(error),
    });
  }
}
