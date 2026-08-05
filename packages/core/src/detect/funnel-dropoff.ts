import { measuredCount } from "../counts/measured-count";

import { PERCENT_SCALE } from "../counts/percent";
import type { EvidenceSignal } from "../evidence/signals";
import type { ThresholdRuleSet } from "../rules/types";
import { sessionWalk, surfaceNormalisationVersionOf, transitionsOf } from "../spine/walk";
import { analysedSessions } from "./analysed";
import type { DetectorCandidate, DetectorCorpus, DetectorResult } from "./types";

const AFTER_FIRST_VISIT_OFFSET = 1;

export function detectFunnelDropoff(
  corpus: DetectorCorpus,
  ruleSet: ThresholdRuleSet,
): DetectorResult {
  const { kept, coverage } = analysedSessions(corpus);
  const walks = kept.map(sessionWalk);

  const candidates: DetectorCandidate[] = [];

  for (const [origin, rawDestinations] of transitionsOf(walks)) {
    const destinations = new Set(
      [...rawDestinations].filter((destination) => destination !== origin),
    );

    if (!destinations.size) continue;

    const atOrigin = walks.filter((walk) => walk.includes(origin));

    if (atOrigin.length < ruleSet.funnelMinSessionsAtOrigin) continue;

    const dropped = atOrigin.filter((walk) => {
      const firstVisit = walk.indexOf(origin);
      return !walk
        .slice(firstVisit + AFTER_FIRST_VISIT_OFFSET)
        .some((path) => destinations.has(path));
    });

    if (dropped.length < ruleSet.funnelMinDropoffSessions) continue;

    if (
      dropped.length * PERCENT_SCALE <
      ruleSet.funnelDropoffRateThresholdPercent * atOrigin.length
    ) {
      continue;
    }

    const countOf = (numerator: number) =>
      measuredCount({
        numerator,

        denominator: corpus.basis.kept,
        unit: "sessions",
        timeframe: corpus.window,
        basis: corpus.basis,
      });

    const originVisits = atOrigin.map((walk) => walk.filter((path) => path === origin).length);
    const attempts = Math.max(...originVisits);
    const strugglingSessions = originVisits.filter(
      (visits) => visits >= ruleSet.struggleRepeatedAttemptMin,
    ).length;

    const signals: EvidenceSignal[] = [];
    if (attempts >= ruleSet.struggleRepeatedAttemptMin) {
      signals.push({
        kind: "struggle",
        subkind: "repeated_attempt",
        surface: origin,
        attempts,

        strugglingSessions: countOf(strugglingSessions),
      });
    }

    candidates.push({
      detector: "funnel_dropoff",
      claimedClass: "confusing",

      claimSubject: "surface",

      surface: origin,
      surfaceNormalisationVersion: surfaceNormalisationVersionOf(kept, origin),
      signals,

      counts: [countOf(atOrigin.length), countOf(dropped.length)],
      timeframe: corpus.window,

      coverage,
    });
  }

  return {
    detector: "funnel_dropoff",

    connectionState: corpus.connectionState,
    coverage,
    candidates,
  };
}
