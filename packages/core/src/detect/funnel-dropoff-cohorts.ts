import { PERCENT_SCALE } from "../counts/percent";
import type { ThresholdRuleSet } from "../rules/types";
import { sessionWalk, transitionsOf } from "../spine/walk";
import { analysedSessions } from "./analysed";
import type { DetectorCorpus, SessionTimeline } from "./types";

const AFTER_FIRST_VISIT_OFFSET = 1;

export type FunnelDropoffCohort = {
  readonly origin: string;
  readonly succeeded: readonly SessionTimeline[];
  readonly failed: readonly SessionTimeline[];
};

type WalkedSession = {
  readonly session: SessionTimeline;
  readonly walk: readonly string[];
};

export function funnelDropoffCohorts(
  corpus: DetectorCorpus,
  ruleSet: ThresholdRuleSet,
): readonly FunnelDropoffCohort[] {
  const { kept } = analysedSessions(corpus);
  const walked = kept.map((session): WalkedSession => ({ session, walk: sessionWalk(session) }));

  const cohorts: FunnelDropoffCohort[] = [];

  for (const [origin, rawDestinations] of transitionsOf(walked.map((entry) => entry.walk))) {
    const destinations = new Set(
      [...rawDestinations].filter((destination) => destination !== origin),
    );

    if (!destinations.size) continue;

    const atOrigin = walked.filter((entry) => entry.walk.includes(origin));

    if (atOrigin.length < ruleSet.funnelMinSessionsAtOrigin) continue;

    const failed = atOrigin.filter((entry) => {
      const firstVisit = entry.walk.indexOf(origin);
      return !entry.walk
        .slice(firstVisit + AFTER_FIRST_VISIT_OFFSET)
        .some((path) => destinations.has(path));
    });

    if (failed.length < ruleSet.funnelMinDropoffSessions) continue;

    if (
      failed.length * PERCENT_SCALE <
      ruleSet.funnelDropoffRateThresholdPercent * atOrigin.length
    ) {
      continue;
    }

    const failedSet = new Set(failed);
    const succeeded = atOrigin.filter((entry) => !failedSet.has(entry));

    cohorts.push({
      origin,
      succeeded: succeeded.map((entry) => entry.session),
      failed: failed.map((entry) => entry.session),
    });
  }

  return cohorts;
}
