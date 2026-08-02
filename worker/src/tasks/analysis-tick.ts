import type { AnalysisRunRecord, AnalysisRunsRepo, SignatureLedgerService } from "@growthmind/db";
import type { AnalysisStopReason } from "@growthmind/shared";
import { ANALYSIS_RUN_STATUS_MESSAGES, describeError } from "@growthmind/shared";
import type { CandidateFinding } from "@growthmind/core";

import { planCandidate } from "../analysis/plan";
import { toCountRows } from "../analysis/shapes";
import type { RunTally } from "../analysis/tally";
import { applyAttribution, newTally, outcomeFor } from "../analysis/tally";
import { tenantContextFor } from "../analysis/types";
import type {
  AnalysisLane,
  AnalysisLaneDeps,
  AnalysisLogger,
  AnalysisTickDeps,
  AnalysisTickSummary,
  LaneOutcome,
} from "../analysis/types";

export type {
  AnalysisLane,
  AnalysisLaneDeps,
  AnalysisLaneSource,
  AnalysisLogger,
  AnalysisTickDeps,
  AnalysisTickSummary,
  AnalysisRunsRepoFor,
  ConfiguredSummariser,
  FindingsRepoFor,
  LaneOutcome,
  SignatureLedgerFor,
} from "../analysis/types";
export { ANALYSIS_ACTOR_ID } from "../analysis/types";

export type LaneTally = {
  readonly findingsPersisted: number;
  readonly unrenderable: number;
  readonly refused: number;
  readonly modelCallsAttempted: number;
};

export type LaneRunResult = {
  readonly outcome: LaneOutcome;
  readonly tally: LaneTally;
};

const NO_WORK_DONE: LaneTally = {
  findingsPersisted: 0,
  unrenderable: 0,
  refused: 0,
  modelCallsAttempted: 0,
};

function laneTallyOf(tally: RunTally): LaneTally {
  return {
    findingsPersisted: tally.findingsPersisted,
    unrenderable: tally.unrenderable,
    refused: tally.refused,
    modelCallsAttempted: tally.modelCallsAttempted,
  };
}

const CHECK_DID_NOT_FINISH: string = ANALYSIS_RUN_STATUS_MESSAGES.failed;
 
async function recordIdentity(
  ledger: SignatureLedgerService,
  lane: AnalysisLane,
  candidate: CandidateFinding,
  signature: string,
  logger: AnalysisLogger,
): Promise<void> {
  try {
    await ledger.recordSignature(lane.projectId, candidate);
  } catch (error) {
    logger.error(
      `analysis tick: candidate ${signature} was recorded as a finding but its identity could not be filed — ${describeError(error)}`,
    );
  }
}

async function closeRun(
  deps: AnalysisLaneDeps,
  runs: AnalysisRunsRepo,
  lane: AnalysisLane,
  run: AnalysisRunRecord,
  tally: RunTally,
  status: "completed" | "failed",
  stopReason: AnalysisStopReason,
): Promise<void> {
  try {
    await runs.close({
      runId: run.id,
      projectId: lane.projectId,
      status,
      outcome: outcomeFor(lane),
      stopReason,
      finishedAt: deps.now(),
      modelCallsAttempted: tally.modelCallsAttempted,
       
      candidatesUnrenderable: tally.unrenderable,
      candidatesRefused: tally.refused,
      resolvedModelId: tally.resolvedModelId,
      tokensIn: tally.tokensIn,
      tokensOut: tally.tokensOut,
       
      failureReason: status === "failed" ? CHECK_DID_NOT_FINISH : null,
    });
  } catch (error) {
     
    deps.logger.error(
      `analysis tick: project ${lane.projectId} finished but its run could not be closed, so this check's own record of what it did is lost and a later check will reclaim the run as abandoned — ${describeError(error)}`,
    );
  }
}

export async function runAnalysisLane(
  deps: AnalysisLaneDeps,
  lane: AnalysisLane,
  at: Date,
): Promise<LaneRunResult> {
  const tickAt = at;
  const ctx = tenantContextFor(lane);
  const findings = deps.findingsFor(ctx);
  const runs = deps.runsFor(ctx);
  const ledger = deps.ledgerFor(ctx);

  const opened = await runs.open({ projectId: lane.projectId, tickAt });

  if (!opened.opened) {
     
    deps.logger.info(
      `analysis tick: project ${lane.projectId} is already being checked by another run, so this tick left it alone`,
    );
    return { outcome: "already_running", tally: NO_WORK_DONE };
  }

  const run = opened.run;
  const tally = newTally();

  try {
     
    for (const [index, candidate] of lane.candidates.entries()) {
      const plan = await planCandidate(
        deps,
        lane,
        runs,
        findings,
        run,
        candidate,
        index + 1,
        tickAt,
      );

      if (plan.capExhausted) tally.capExhausted = true;

      if (plan.action.kind === "reuse") {
        tally.findingsPersisted += 1;
        continue;
      }

      if (plan.action.kind === "refused") {
         
        tally.refused += 1;
        continue;
      }

      if (plan.action.kind === "unrenderable") {
         
        tally.unrenderable += 1;
        continue;
      }

      const rendered = plan.action.summary;
      const identity = plan.action.identity;
      applyAttribution(tally, rendered.attribution);

      await findings.persist({
        projectId: lane.projectId,
        runId: run.id,
        signature: identity.signature,
        signatureVersion: identity.signatureVersion,
        summarySource: rendered.summarySource,
        headline: rendered.headline,
        context: rendered.context,
        finalClass: candidate.finalClass,
        surface: candidate.surface,
         
        surfaceNormalisationVersion: candidate.surfaceNormalisationVersion,
        counts: toCountRows(candidate),
        confidenceBasis: candidate.ranking.confidenceBasis,
        windowStart: candidate.timeframe.start,
        windowEnd: candidate.timeframe.end,
        evidenceShape: candidate.evidenceShape,
        evidenceShapeVersion: candidate.evidenceShapeVersion,
        resolvedModelId: rendered.attribution.resolvedModelId,
         
        tokensIn: rendered.attribution.usage.inputTokens ?? null,
        tokensOut: rendered.attribution.usage.outputTokens ?? null,
      });

      tally.findingsPersisted += 1;

      await recordIdentity(ledger, lane, candidate, identity.signature, deps.logger);
    }
  } catch (error) {
     
    deps.logger.error(
      `analysis tick: project ${lane.projectId} could not finish its check — ${describeError(error)}`,
    );
    await closeRun(deps, runs, lane, run, tally, "failed", "fatal_error");
     
    return { outcome: "failed", tally: laneTallyOf(tally) };
  }

  await closeRun(
    deps,
    runs,
    lane,
    run,
    tally,
    "completed",
    tally.capExhausted ? "cap_exhausted" : "ran_to_completion",
  );

  return { outcome: "completed", tally: laneTallyOf(tally) };
}

export async function runAnalysisTick(deps: AnalysisTickDeps): Promise<AnalysisTickSummary> {
  const tickAt = deps.now();
  const lanes = await deps.lanes.listDueLanes(tickAt);

  const summary: AnalysisTickSummary = {
    lanesConsidered: lanes.length,
    lanesRun: 0,
    lanesAlreadyRunning: 0,
    lanesFailed: 0,
    lanesErrored: 0,
    findingsPersisted: 0,
    candidatesUnrenderable: 0,
    candidatesRefused: 0,
    modelCallsAttempted: 0,
  };

  if (lanes.length === 0) {
    return summary;
  }

  for (const lane of lanes) {
    try {
      const { outcome, tally } = await runAnalysisLane(deps, lane, tickAt);

      summary.findingsPersisted += tally.findingsPersisted;
      summary.candidatesUnrenderable += tally.unrenderable;
      summary.candidatesRefused += tally.refused;
      summary.modelCallsAttempted += tally.modelCallsAttempted;

      if (outcome === "completed") summary.lanesRun += 1;
      if (outcome === "failed") {
        summary.lanesRun += 1;
        summary.lanesFailed += 1;
      }
      if (outcome === "already_running") summary.lanesAlreadyRunning += 1;
    } catch (error) {
       
      deps.logger.error(
        `analysis tick: project ${lane.projectId} could not be processed — ${describeError(error)}`,
      );
      summary.lanesErrored += 1;
    }
  }

  deps.logger.info(
     
    `analysis tick: lanes ${String(summary.lanesConsidered)}, checked ${String(summary.lanesRun)} (${String(summary.lanesFailed)} did not finish), already running ${String(summary.lanesAlreadyRunning)}, errored ${String(summary.lanesErrored)}, findings ${String(summary.findingsPersisted)}, asked a model to write up ${String(summary.modelCallsAttempted)}, not written up at all ${String(summary.candidatesUnrenderable)}, turned away before we looked at them ${String(summary.candidatesRefused)}`,
  );

  return summary;
}
