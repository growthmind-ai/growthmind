import type { CandidateFinding } from "@growthmind/core";
import {
  applyCitationGate,
  beatsFromActions,
  guardCauseText,
  reviewFindingText,
  type PersistedSessionAction,
} from "@growthmind/core";
import type {
  CauseClaimsRepo,
  ClaimModelCallInput,
  ClaimModelCallResult,
  DivergencePointsRepo,
  SessionRecordingCitation,
} from "@growthmind/db";
import { describeHold } from "@growthmind/db";
import { describeError, MODEL_CALL_STAGE } from "@growthmind/shared";

import type { AnalysisLane, AnalysisLaneDeps, CandidateIdentity } from "./types";
import { tenantContextFor } from "./types";

// ADD Decision 4: up to 3 sessions from the front of the failed cohort's
// deterministically-sorted sample are tried, in one batched citationsFor call,
// for the first with a readable transcript.
const CAUSE_ANCHOR_SESSION_CANDIDATES = 3;

// The cap-ledger claim for the cause stage never carries a runId of its own —
// planCause is called from inside runAnalysisLane's candidate loop, which
// already has a run open for the render stage's own claims, and the caller
// (worker/src/tasks/analysis-tick.ts) binds that run's id at the call site.
// This keeps planCause itself free of a value it has no way to originate.
export type CauseClaimInput = Omit<ClaimModelCallInput, "runId">;

export interface CauseAnalysisRunsRepo {
  claimModelCall(input: CauseClaimInput): Promise<ClaimModelCallResult>;
}

function readableTranscript(
  citation: SessionRecordingCitation | undefined,
): citation is SessionRecordingCitation & { actions: readonly PersistedSessionAction[] } {
  return citation !== undefined && citation.actions !== null && citation.actions.length > 0;
}

export async function planCause(
  deps: AnalysisLaneDeps,
  lane: AnalysisLane,
  runs: CauseAnalysisRunsRepo,
  causeClaims: CauseClaimsRepo,
  divergencePoints: DivergencePointsRepo,
  findingId: string,
  identity: CandidateIdentity,
  candidate: CandidateFinding,
  tickAt: Date,
): Promise<void> {
  if (deps.causeExplainer === null) {
    return;
  }
  const explainer = deps.causeExplainer;

  // Step 1 + 2 (ADD Decision 7): bind the divergence row to this candidate's own
  // window, then require it to be a diverged row (FR-1). A window mismatch is
  // treated identically to "no row yet" — cheap to retry next tick, nothing spent.
  const row = await divergencePoints.findSurfaceCut(lane.projectId, candidate.surface);
  if (row === null) {
    return;
  }
  if (
    row.windowStart.getTime() !== candidate.timeframe.start.getTime() ||
    row.windowEnd.getTime() !== candidate.timeframe.end.getTime()
  ) {
    return;
  }
  if (row.kind !== "diverged") {
    return;
  }

  // Step 3: resolve the anchor session, one batched citationsFor call across up
  // to the first 3 failed-cohort sessions, in order. None readable: stop, no
  // claim spent (D5/D8) — this is retried fresh next tick, not foreclosed.
  const ctx = tenantContextFor(lane);
  const sampleSessionIds = row.failedSessionIdsSample.slice(0, CAUSE_ANCHOR_SESSION_CANDIDATES);
  const citations = await deps
    .recordingSummariesFor(ctx)
    .citationsFor(lane.projectId, sampleSessionIds);
  const citationsBySessionId = new Map(citations.map((citation) => [citation.sessionId, citation]));

  const anchor = sampleSessionIds
    .map((sessionId) => citationsBySessionId.get(sessionId))
    .find(readableTranscript);

  if (anchor === undefined) {
    return;
  }

  // Step 4: claim the cap-ledger slot at the cause stage, same signature the
  // render stage already claimed under stage: "render" — the two stages claim
  // independently (ADD Decision 2). already_claimed and cap_exhausted both stop
  // here, silently: exactly one attempt, ever, per finding (D3).
  const claim = await runs.claimModelCall({
    projectId: lane.projectId,
    signature: identity.signature,
    signatureVersion: identity.signatureVersion,
    projectCap: deps.projectCap,
    organizationCap: deps.organizationCap,
    at: tickAt,
    stage: MODEL_CALL_STAGE.CAUSE,
  });

  if (!claim.claimed) {
    if (claim.reason === "cap_exhausted") {
      deps.logger.error(
        `analysis tick: candidate ${identity.signature} could not be explained because the model-call cap is exhausted`,
      );
    }
    return;
  }

  const beats = beatsFromActions(anchor.actions);

  // Step 5: call the model. A throw or an ok:false result stops here, no row,
  // never retried and never blocking the tick (D8).
  let result;
  try {
    result = await explainer.port.explain({
      surface: candidate.surface,
      succeededCohortSize: row.succeededCohortSize,
      failedCohortSize: row.failedCohortSize,
      divergedAtRank: row.divergedAtRank ?? 0,
      beats: beats.map((beat) => ({ index: beat.index, kind: beat.kind, text: beat.text })),
    });
  } catch (error) {
    deps.logger.error(
      `analysis tick: candidate ${identity.signature} could not be explained — the model call threw — ${describeError(error)}`,
    );
    return;
  }

  if (!result.ok) {
    deps.logger.info(
      `analysis tick: candidate ${identity.signature} has no cause explanation — ${result.message}`,
    );
    return;
  }

  // Step 6, gate 1 (ADD Decision 6): a single offending claim refuses the whole
  // response, never trimmed to the clean claims.
  const guard = guardCauseText(result.claims);
  if (!guard.ok) {
    deps.logger.info(
      `analysis tick: candidate ${identity.signature} had a cause explanation that did not pass the accuracy check (${guard.offences.join(", ")}), so it was left out`,
    );
    return;
  }

  // Step 7, gate 2: a claim survives only if every cited index is in range.
  // Zero survivors and zero drops means the model looked and found nothing —
  // Decision 3's table treats that identically to never-attempted: no row.
  const { survivors, droppedCount } = applyCitationGate(result.claims, beats.length);
  if (survivors.length === 0 && droppedCount === 0) {
    return;
  }

  // Step 8: PII scan bound at this call site specifically (FR-7), never
  // inherited from the render stage's own binding. A hold stops here — no row
  // to touch, so "no row" is already the withheld behaviour.
  const text = reviewFindingText({
    headline: "",
    context: survivors.map((survivor) => survivor.statement),
  });
  if (text.held) {
    const hold = describeHold(text);
    deps.logger.info(
      `analysis tick: candidate ${identity.signature} had a cause explanation that still carried something that must not be shown (${hold.reason}/${String(hold.kind)}), so it was left out`,
    );
    return;
  }

  // Step 9: persist iff the gate had something to accept or reject
  // (Decision 3's predicate — already guaranteed true here).
  await causeClaims.persist({
    projectId: lane.projectId,
    findingId,
    anchorSessionId: anchor.sessionId,
    claims: survivors,
    droppedClaims: droppedCount,
    resolvedModelId: result.resolvedModelId,
    tokensIn: result.usage.inputTokens ?? null,
    tokensOut: result.usage.outputTokens ?? null,
  });
}
