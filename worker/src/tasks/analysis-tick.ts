/**
 * The analysis lane's composition root: open a run, walk each candidate down a fixed
 * ladder of degradations, persist a finding on whichever rung applies, close the run.
 * Every path out of an opened run must close it: a row left `running` blocks every
 * future run for that project behind the partial unique index.
 * Design rationale: docs/decisions/0002-analysis-tick-orchestration.md
 */
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

// The lane's vocabulary is re-exported, not re-declared The shapes below live in
// `../analysis/types.ts`, the bottom of this lane's dependency graph. They are
// re-exported here because this module is the lane's public face: `../index.ts`
// composes the tick, `../analysis-lane-source.ts` implements its port,
// `./onboarding-analysis.ts` runs one lane, and the suite drives `runAnalysisTick`.
// Every one of them names this file, and none of them should have to learn the lane's
// internal layout to do it.
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

/**
 * What one lane's run contributed, handed BACK to whoever asked for it (AD-9).
 *
 * These four counts are exactly the ones `runAnalysisTick` folds into its
 * summary, and they are RETURNED rather than accumulated into a caller's object
 * that this function mutates. That is the one behavioural change the extraction
 * makes, and it is what lets a second caller — the onboarding trigger, which has
 * no summary and wants none — run a lane without inventing a scratch object to
 * be written into.
 *
 * The run row remains the DURABLE record of all of this (`closeRun` writes
 * `candidates_unrenderable` / `candidates_refused` / `modelCallsAttempted`
 * before this value is built). A tally that lived only here would die with the
 * process; this one is a report to the caller, never the storage.
 */
export type LaneTally = {
  readonly findingsPersisted: number;
  readonly unrenderable: number;
  readonly refused: number;
  readonly modelCallsAttempted: number;
};

/** One lane's turn: what happened, and what it contributed. */
export type LaneRunResult = {
  readonly outcome: LaneOutcome;
  readonly tally: LaneTally;
};

/**
 * The tally of a lane that did no work at all — the `already_running` path.
 *
 * Zeroes rather than an absent tally, so a caller folds unconditionally and no
 * branch can forget to. `already_running` is the single-writer guarantee
 * WORKING (D6), not a failure, and it costs nothing: no candidates, no claims,
 * and above all no terminal write onto a run somebody else is still walking.
 */
const NO_WORK_DONE: LaneTally = {
  findingsPersisted: 0,
  unrenderable: 0,
  refused: 0,
  modelCallsAttempted: 0,
};

/** The four counts that cross the boundary, off the run's own accumulated
 *  facts. The other four members of `RunTally` (`resolvedModelId`, the two token
 *  totals, `capExhausted`) are the RUN ROW's business and were already written
 *  by `closeRun`; re-reporting them to a caller would invite a second home for
 *  facts that have one. */
function laneTallyOf(tally: RunTally): LaneTally {
  return {
    findingsPersisted: tally.findingsPersisted,
    unrenderable: tally.unrenderable,
    refused: tally.refused,
    modelCallsAttempted: tally.modelCallsAttempted,
  };
}

/**
 * The one-home sentence for "this check did not finish", resolved once.
 *
 * `failure_reason` is what a founder reads when a run ends early, so it is drawn from
 * `@growthmind/shared`'s audited table rather than authored here. A second copy of a
 * customer-facing sentence is how the one-home rule dies. It is deliberately not the
 * thrown error's own text: a store or a port can put ids, hostnames and stack fragments
 * in a message, and this column is read by a person. The log gets the detail (logs are
 * ours); the row gets this.
 */
const CHECK_DID_NOT_FINISH: string = ANALYSIS_RUN_STATUS_MESSAGES.failed;
/**
 * Records the finding's identity on the ledger, as a side effect.
 *
 * Isolated in its own try/catch and never propagated: the finding is the main flow and
 * this write is not. A missed record surfaces later as an identity that may be
 * delivered again (recoverable) where a propagated failure would cost the run every
 * candidate after this one.
 *
 * `recordSignature` is the only ledger entry point this lane may call, and it shares
 * the signature's one producer with `identityFor` above. The service composes
 * `signatureTuple` and `sha256Hex` itself, `identityFor` calls that same
 * `computeFindingSignature`, and neither re-implements the hash. The row this lane just
 * persisted and the ledger row written here therefore carry the same signature by
 * construction rather than by two derivations agreeing.
 *
 * `signature` is passed in only so the log line can name the identity the failure is
 * about. Nothing here derives it a second time.
 */
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


/**
 * The terminal write. Never throws: this is the last thing standing between a lane and
 * a row left `running`, and a run left `running` makes every future run for that
 * project un-openable behind the partial unique index. A fault here is logged loudly
 * rather than propagated, which would leave the row exactly as stuck and lose the log
 * line.
 */
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
      // The candidates that produced no finding, made durable. Counted in memory during
      // the walk and written here, because a tally that dies with the process leaves a
      // run reporting `produced_findings` / `ran_to_completion` over zero rows. "we
      // lost some" decaying into "we checked everything", which is SAC-10's shape one
      // level down. No floor sentence is invented for them: the count is the fact, and
      // the refusal to phrase what could not honestly be phrased stands.
      candidatesUnrenderable: tally.unrenderable,
      candidatesRefused: tally.refused,
      resolvedModelId: tally.resolvedModelId,
      tokensIn: tally.tokensIn,
      tokensOut: tally.tokensOut,
      // Plain English on a failure, and nothing on a success. A sentence on a completed
      // run would be a claim about a problem that did not happen.
      failureReason: status === "failed" ? CHECK_DID_NOT_FINISH : null,
    });
  } catch (error) {
    // Not "this may block the next check". That was true before the lease landed.
    // `analysis_runs` now hands a `running` row back to the next tick once it is older
    // than `ANALYSIS_RUN_LEASE_MS` (45 minutes, deliberately shorter than this task's
    // hourly cron), which closes it `failed` and reopens the lane. So the cost of this
    // fault is bounded and known: this run's own verdict is lost, and the row reads as
    // an abandoned run rather than as what actually happened.
    deps.logger.error(
      `analysis tick: project ${lane.projectId} finished but its run could not be closed, so this check's own record of what it did is lost and a later check will reclaim the run as abandoned — ${describeError(error)}`,
    );
  }
}

/**
 * ONE PROJECT'S TURN — THE WHOLE LANE, AND THE ONLY PLACE IT EXISTS (AD-9).
 *
 * Returns an outcome and a tally on every path. The run is opened first and closed on
 * every path out of a successful open, including the one where a candidate's persistence
 * fails, which ends the lane rather than continuing against a store that has stopped
 * answering.
 *
 * ── WHY THIS IS EXPORTED, AND WHY THAT IS THE GUARANTEE ─────────────────────
 * Two callers reach this function: the hourly `analysis:tick` cron, and the
 * onboarding trigger that fires seconds after a founder breaks their own product
 * (`./onboarding-analysis.ts`). FR-O17 says the fast path "respects the
 * single-writer index AND the cap ledger, or it does not ship", and names a
 * cap-bypassing trigger a financial commitment.
 *
 * The strongest available form of that promise is NOT a test that the trigger
 * calls `claimModelCall` correctly — it is that THE TRIGGER HAS NO MODEL-CALL
 * SITE OF ITS OWN TO GET WRONG. This function is the code that opens the run
 * against `analysis_runs_one_open_per_project_key`, claims through
 * `claimModelCall` under BOTH ceilings, walks the eight-rung ladder, and closes
 * the run terminally on every exit path. The trigger contributes a project id.
 *
 * So: no second lane runner may be written beside this one, and this function
 * may not take `lanes` — see `AnalysisLaneDeps`, where the absence is stated as
 * a contract rather than left as an accident of what it happens to reference.
 *
 * `at` rather than `tickAt`: the instant is the CALLER'S, and it is threaded all
 * the way into `runs.open` so the abandoned-run lease (`ANALYSIS_RUN_LEASE_MS`)
 * is evaluated against it. A runner that read a clock of its own would give the
 * two callers different answers about the same jammed project.
 */
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
    // A run for this project is already open. The partial unique index refused ours,
    // and that refusal IS the single-writer guarantee the cap's count subquery rests
    // on, two runs sharing one project would each believe there was budget. So this
    // tick does nothing: no candidates, no claims, and above all no terminal write,
    // which would stamp our outcome onto a run somebody else is still working.
    deps.logger.info(
      `analysis tick: project ${lane.projectId} is already being checked by another run, so this tick left it alone`,
    );
    return { outcome: "already_running", tally: NO_WORK_DONE };
  }

  const run = opened.run;
  const tally = newTally();

  try {
    // One at a time, in the source's order. Never `Promise.all`: the cap is spent in
    // order, and a lane whose budget went to whichever candidate resolved first would
    // answer differently on every run for one input.
    //
    // The position is carried for log lines only (see `surfaceIsSafeToSend`). It names
    // which candidate of this walk a refusal is about, at a point where no safe stable
    // identifier exists yet, and it is 1-based because a person reads it. Nothing keys
    // on it: a candidate's position is exactly the churny input removed from its
    // identity.
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

      // Recorded before anything else can go wrong. A spent cap is a fact about the
      // claim, and it must survive a floor refusal, a store failure, or anything else
      // downstream. "we stopped early" may never decay into "we checked everything
      // there was to check" (SAC-10).
      if (plan.capExhausted) tally.capExhausted = true;

      if (plan.action.kind === "reuse") {
        tally.findingsPersisted += 1;
        continue;
      }

      if (plan.action.kind === "refused") {
        // Already logged by `surfaceIsSafeToSend` or by `identityFor`. Counted, never
        // silent, and it does not fail the run: one candidate the gate refused, or one
        // whose identity could not be minted, must not cost this project every other
        // candidate (isolation). Kept apart from `unrenderable` all the way to the tick
        // summary.
        tally.refused += 1;
        continue;
      }

      if (plan.action.kind === "unrenderable") {
        // Already logged by `floorTextFor`. Counted, never silent, and it does not fail
        // the run: one candidate the floor refused must not cost this project every
        // other candidate (isolation).
        tally.unrenderable += 1;
        continue;
      }

      const rendered = plan.action.summary;
      const identity = plan.action.identity;
      applyAttribution(tally, rendered.attribution);

      // One insert against the unique `(org, project, signature)`, never a
      // check-then-write. A replay conflicts and reads back the row it already wrote,
      // which is what makes retry safety a property of this statement rather than of
      // the order the candidates happened to arrive in. The signature is the one the
      // claim above was taken on, carried on the plan and not re-derived here.
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
        // Copied, not substituted. The column is nullable and the candidate's own
        // `null` means "no normaliser version was recorded". A fact, and one this file
        // must not overwrite. It previously wrote `0` there, which the candidate
        // contract allows a producer to emit as a real version
        // (`core/src/findings/candidate.ts:93` is `.nullable` and not `.positive`),
        // so absence and v0 became one stored value on a column that feeds identity
        // comparisons.
        surfaceNormalisationVersion: candidate.surfaceNormalisationVersion,
        counts: toCountRows(candidate),
        confidenceBasis: candidate.ranking.confidenceBasis,
        windowStart: candidate.timeframe.start,
        windowEnd: candidate.timeframe.end,
        evidenceShape: candidate.evidenceShape,
        evidenceShapeVersion: candidate.evidenceShapeVersion,
        resolvedModelId: rendered.attribution.resolvedModelId,
        // `?? null`, never `?? 0`. A candidate the model touched but did not meter must
        // not look identical to one that cost nothing.
        tokensIn: rendered.attribution.usage.inputTokens ?? null,
        tokensOut: rendered.attribution.usage.outputTokens ?? null,
      });

      tally.findingsPersisted += 1;

      // After the finding is durable, and isolated from it.
      await recordIdentity(ledger, lane, candidate, identity.signature, deps.logger);
    }
  } catch (error) {
    // A candidate's write, a claim, or a reuse read failed mid-run. The work already
    // done stands. A half-run that rolled back its earlier findings would lose them to
    // a fault that had nothing to do with them, and the run is closed `failed` so it
    // cannot jam this project's lane.
    deps.logger.error(
      `analysis tick: project ${lane.projectId} could not finish its check — ${describeError(error)}`,
    );
    await closeRun(deps, runs, lane, run, tally, "failed", "fatal_error");
    // THE WORK ALREADY DONE IS STILL REPORTED. A failed lane that returned an
    // empty tally would tell its caller nothing was found by a run that in fact
    // wrote findings before it broke — "we lost some" decaying into "there was
    // nothing", one level up from where `closeRun` refuses the same collapse.
    return { outcome: "failed", tally: laneTallyOf(tally) };
  }

  // A spent cap is not a failure and not an empty answer. The run completed and every
  // candidate was reported; `cap_exhausted` says only that the ones past the limit have
  // no written explanation (SAC-10).
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

/**
 * Open, walk the ladder, persist, close. Once per due project.
 *
 * A tick with no due lanes is a clean no-op: no crash, no error state, and nothing
 * recorded. An installation with no project connected, or none with enough activity to
 * look at, is a supported deployment (the self-host graceful-absence promise), and
 * recording something here would make "nothing is attached" indistinguishable from "we
 * looked and there was nothing". The one distinction this lane's whole vocabulary
 * exists to keep.
 *
 * The lane read is deliberately outside the isolation: if the source itself fails there
 * are no lanes to isolate from each other, and letting it throw is what makes Graphile
 * Worker retry the tick rather than record a healthy-looking run over a read that never
 * happened.
 */
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

      // FOLDED HERE, UNCONDITIONALLY, from a value the lane RETURNED. The lane
      // used to be handed this summary and write into it; a runner that mutates
      // its caller's accumulator cannot be called by anyone who does not have
      // one, which is exactly the position the onboarding trigger is in.
      // `already_running` folds four zeroes, so no branch has to remember to
      // skip it.
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
      // Per-lane isolation. One project's fault, a context that will not build, a
      // repository factory that throws, a run that cannot be opened. Cannot cost every
      // other project its check. The loop continues, and the next project is analysed.
      deps.logger.error(
        `analysis tick: project ${lane.projectId} could not be processed — ${describeError(error)}`,
      );
      summary.lanesErrored += 1;
    }
  }

  deps.logger.info(
    // `modelCallsAttempted` counts attempts, not successes: a call that failed, came
    // back unreadable or was refused by the accuracy check is counted here and was not
    // written up. Labelling it "written up" overstated every one of those, on the one
    // line a reader uses to see what a tick did.
    `analysis tick: lanes ${String(summary.lanesConsidered)}, checked ${String(summary.lanesRun)} (${String(summary.lanesFailed)} did not finish), already running ${String(summary.lanesAlreadyRunning)}, errored ${String(summary.lanesErrored)}, findings ${String(summary.findingsPersisted)}, asked a model to write up ${String(summary.modelCallsAttempted)}, not written up at all ${String(summary.candidatesUnrenderable)}, turned away before we looked at them ${String(summary.candidatesRefused)}`,
  );

  return summary;
}
