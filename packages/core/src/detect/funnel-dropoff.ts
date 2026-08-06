import { measuredCount } from "../counts/measured-count";

import type { EvidenceSignal } from "../evidence/signals";
import type { ThresholdRuleSet } from "../rules/types";
import { sessionWalk, surfaceNormalisationVersionOf } from "../spine/walk";
import { analysedSessions } from "./analysed";
import { funnelDropoffCohorts } from "./funnel-dropoff-cohorts";
import type { DetectorCandidate, DetectorCorpus, DetectorResult } from "./types";

export function detectFunnelDropoff(
  corpus: DetectorCorpus,
  ruleSet: ThresholdRuleSet,
): DetectorResult {
  const { kept, coverage } = analysedSessions(corpus);
  const cohorts = funnelDropoffCohorts(corpus, ruleSet);

  const candidates: DetectorCandidate[] = [];

  for (const cohort of cohorts) {
    const countOf = (numerator: number) =>
      measuredCount({
        numerator,

        denominator: corpus.basis.kept,
        unit: "sessions",
        timeframe: corpus.window,
        basis: corpus.basis,
      });

    const atOrigin = [...cohort.succeeded, ...cohort.failed];
    const originVisits = atOrigin.map(
      (session) => sessionWalk(session).filter((path) => path === cohort.origin).length,
    );
    const attempts = Math.max(...originVisits);
    const strugglingSessions = originVisits.filter(
      (visits) => visits >= ruleSet.struggleRepeatedAttemptMin,
    ).length;

    const signals: EvidenceSignal[] = [];
    if (attempts >= ruleSet.struggleRepeatedAttemptMin) {
      signals.push({
        kind: "struggle",
        subkind: "repeated_attempt",
        surface: cohort.origin,
        attempts,

        strugglingSessions: countOf(strugglingSessions),
      });
    }

    candidates.push({
      detector: "funnel_dropoff",
      claimedClass: "confusing",

      claimSubject: "surface",

      surface: cohort.origin,
      surfaceNormalisationVersion: surfaceNormalisationVersionOf(kept, cohort.origin),
      signals,

      counts: [countOf(atOrigin.length), countOf(cohort.failed.length)],
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
