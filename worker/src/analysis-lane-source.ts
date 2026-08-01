// The adapter behind the analysis lane. The join this repository was missing.
//
// `runAnalysisTick` consumes `AnalysisLane`s through a port and nothing in production
// produced one: the corpus service, both T1 detectors, the evidence gate and the
// candidate contract all shipped proven against fakes. This module is the wiring
// between them and deliberately nothing else. Every judgement lives in the shipped
// piece that owns it, and the one new decision here (the analysis window) is a named
// constant with its rationale.
//
// That decision is the hazard this outcome exists to close, so say the wire out loud:
// `resolveAnalysisLanes` in./index.ts returns `createAnalysisLaneSource`, and from
// that moment the tick's graceful-absence line means "no projects connected", never "no
// producer written".
import {
  assembleCandidates,
  detectErrorEvent,
  detectFunnelDropoff,
  THRESHOLD_RULE_SET_VERSION,
  THRESHOLD_RULE_SETS,
} from "@growthmind/core";
import type { ThresholdRuleSet } from "@growthmind/core";
import type { ScopedDb } from "@growthmind/db";
import { createDetectorCorpusService } from "@growthmind/db";
import { SYSTEM_ACTOR, listAnalysableProjects, systemContextFor } from "@growthmind/db/system";
import { describeError } from "@growthmind/shared";
import type { TenantContext } from "@growthmind/shared";

import { type AnalysisLane, type AnalysisLaneSource, type AnalysisLogger } from "./analysis/types";

/**
 * The trailing window a tick analyses, ending at the tick's own instant.
 *
 * Seven days, and the reasoning is the detectors': every magnitude in the rule set is
 * an absolute cohort floor (3 struggling sessions, 3 correlated failures, 20 at an
 * origin), so the window's job is to hold enough sessions for a real pattern to clear
 * those floors on a small installation, while staying short enough that a fixed defect
 * stops being re-claimed within a week of its fix. The corpus read caps sessions and
 * reports the cap (`coverage.truncated`), so a large installation's cost is bounded by
 * the cap, not the window; and re-analysis of an unchanged week is already harmless by
 * construction. The signature ledger dedups findings and the run claim caps model
 * spend.
 *
 * A policy default, not a contract: it is exported so the composition test pins it, and
 * a later sprint may make it configurable per project without touching this module's
 * shape (the window is derived from `now` here and injected downward, so nothing
 * beneath reads a clock either way).
 */
export const ANALYSIS_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;

/**
 * The rule set every lane this producer builds is judged under. Fetched by version
 * through the registry, never as "whatever is current". The constant IS the current
 * version's number, but going through `.get` keeps the invariant that only registered
 * rule sets ever judge anything, and the throw names the defect if the registry and the
 * constant ever disagree.
 */
function analysisRuleSet(): ThresholdRuleSet {
  const rules = THRESHOLD_RULE_SETS.get(THRESHOLD_RULE_SET_VERSION);
  if (!rules) {
    throw new Error(
      `analysis lane source: THRESHOLD_RULE_SETS has no entry for its own current version ` +
        `${String(THRESHOLD_RULE_SET_VERSION)} — the registry and the constant have drifted apart`,
    );
  }
  return rules;
}

/** The same context derivation the tick itself uses: from the row being processed,
 * through the one accepted schema, under the analysis actor. */
function contextFor(project: {
  readonly organizationId: string;
  readonly organizationName: string;
}): TenantContext {
  return systemContextFor(SYSTEM_ACTOR.ANALYSIS_TICK, project);
}

export interface AnalysisLaneSourceDeps {
  readonly db: ScopedDb;
  readonly logger: AnalysisLogger;
}

/**
 * The production `AnalysisLaneSource`: every project with an active connection, its
 * corpus read over the trailing window, both T1 detectors run, every proposal through
 * the evidence gate, and the survivors assembled into one lane per project.
 *
 * Per-project isolation, here as well as in the tick: the tick isolates lane
 * processing, but this source runs before its loop, one project's corpus read throwing
 * inside `listDueLanes` would otherwise cost every other project its analysis. A failed
 * project is logged and skipped; the lane list carries everyone else.
 *
 * What a lane's emptiness means is decided by the data, never inferred (the tick's own
 * vocabulary): `sessionsConsidered` is the corpus's `basis.kept`, so an empty
 * `candidates` with sessions considered reads `no_candidates_passed_gate`, and with
 * none, `no_sessions_to_analyse`. Both degrade to named outcomes downstream. Neither is
 * a crash and neither is a silent success. Gate-rejected candidates are logged here,
 * with their count, because the gate's verdict is final and nothing downstream may see
 * them. A drop that also vanished from the logs would be undebuggable.
 */
export function createAnalysisLaneSource(deps: AnalysisLaneSourceDeps): AnalysisLaneSource {
  return {
    async listDueLanes(now: Date): Promise<readonly AnalysisLane[]> {
      const rules = analysisRuleSet();
      // The window derives from the injected tick instant. This module reads no clock
      // by any route, so a replayed tick rebuilds identical lanes.
      const window = { start: new Date(now.getTime() - ANALYSIS_WINDOW_MS), end: now };

      const projects = await listAnalysableProjects(deps.db);
      const lanes: AnalysisLane[] = [];

      for (const project of projects) {
        try {
          const ctx = contextFor(project);
          const corpus = await createDetectorCorpusService(deps.db, ctx).read(
            project.projectId,
            window,
          );

          // Both T1 detectors, every tick, every project. Pure calls over the one
          // corpus read. The assembler owns the gate walk and the one-lane-per-project
          // flattening.
          const { candidates, rejected } = assembleCandidates(
            [detectFunnelDropoff(corpus, rules), detectErrorEvent(corpus, rules)],
            rules,
          );

          for (const rejection of rejected) {
            deps.logger.info(
              `analysis lane source: gate rejected a ${rejection.detector} candidate on ` +
                `${rejection.surface} for project ${project.projectId} — final rung unsatisfied, ` +
                `never delivered (trace length ${String(rejection.trace.length)})`,
            );
          }

          lanes.push({
            organizationId: project.organizationId,
            organizationName: project.organizationName,
            projectId: project.projectId,
            candidates,
            // The corpus's own denominator, never re-counted here: this is what keeps
            // `no_candidates_passed_gate` distinguishable from `no_sessions_to_analyse`
            // downstream.
            sessionsConsidered: corpus.basis.kept,
          });
        } catch (error) {
          // One project's fault. An unreadable corpus, a contract violation in
          // assembly. Costs that project this tick, never the fleet. Logged with enough
          // to debug; the tick's own per-lane isolation covers everything after this
          // point.
          deps.logger.error(
            `analysis lane source: skipping project ${project.projectId} (org ` +
              `${project.organizationId}) this tick: ${describeError(error)}`,
          );
        }
      }

      return lanes;
    },
  };
}
