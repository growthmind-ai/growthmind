import {
  assembleCandidates,
  detectErrorEvent,
  detectFunnelDropoff,
  THRESHOLD_RULE_SET_VERSION,
  THRESHOLD_RULE_SETS,
} from "@growthmind/core";
import type { ThresholdRuleSet } from "@growthmind/core";
import type { ScopedDb } from "@growthmind/db";
import { createDetectorCorpusService, describeDriverError } from "@growthmind/db";
import type { AnalysableProject } from "@growthmind/db/system";
import {
  SYSTEM_ACTOR,
  findAnalysableProject,
  listAnalysableProjects,
  systemContextFor,
} from "@growthmind/db/system";
import type { TenantContext } from "@growthmind/shared";

import { type AnalysisLane, type AnalysisLaneSource, type AnalysisLogger } from "./analysis/types";

export const ANALYSIS_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;

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

export function createAnalysisLaneSource(deps: AnalysisLaneSourceDeps): AnalysisLaneSource {
  async function buildLane(project: AnalysableProject, now: Date): Promise<AnalysisLane | null> {
    const rules = analysisRuleSet();

    const window = { start: new Date(now.getTime() - ANALYSIS_WINDOW_MS), end: now };

    try {
      const ctx = contextFor(project);
      const corpus = await createDetectorCorpusService(deps.db, ctx).read(
        project.projectId,
        window,
      );

      deps.logger.info(
        `analysis lane source: project ${project.projectId} kept ` +
          `${String(corpus.basis.kept)} sessions this window, ` +
          `${String(corpus.citations.length)} of them with a recording to cite`,
      );

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

      return {
        organizationId: project.organizationId,
        organizationName: project.organizationName,
        projectId: project.projectId,
        candidates,

        sessionsConsidered: corpus.basis.kept,
      };
    } catch (error) {
      deps.logger.error(
        `analysis lane source: skipping project ${project.projectId} (org ` +
          `${project.organizationId}) this tick: ${describeDriverError(error)}`,
      );
      return null;
    }
  }

  return {
    async listDueLanes(now: Date): Promise<readonly AnalysisLane[]> {
      const projects = await listAnalysableProjects(deps.db);
      const lanes: AnalysisLane[] = [];

      for (const project of projects) {
        const lane = await buildLane(project, now);
        if (lane !== null) lanes.push(lane);
      }

      return lanes;
    },

    async laneForProject(projectId: string, now: Date): Promise<AnalysisLane | null> {
      const project = await findAnalysableProject(deps.db, projectId);
      if (project === null) {
        deps.logger.info(
          `analysis lane source: project ${projectId} has no row to build a lane from, so there is nothing to check`,
        );
        return null;
      }

      return buildLane(project, now);
    },
  };
}
