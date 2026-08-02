import { measuredCount } from "../counts/measured-count";

import { PERCENT_SCALE } from "../counts/percent";
import type { EvidenceSignal } from "../evidence/signals";
import type { ThresholdRuleSet } from "../rules/types";
import { analysedSessions } from "./analysed";
import { orderTimeline } from "./order";
import type { DetectorCandidate, DetectorCorpus, DetectorResult, SessionTimeline } from "./types";

const AFTER_FIRST_VISIT_OFFSET = 1;

function pathWalk(session: SessionTimeline): readonly string[] {
  const walk: string[] = [];
  let previous: string | null = null;

  for (const event of orderTimeline(session.events)) {
    const path = event.urlPath;
    if (path === null) continue;
    if (path !== previous) walk.push(path);
    previous = path;
  }

  return walk;
}

function transitionsOf(
  walks: readonly (readonly string[])[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const transitions = new Map<string, Set<string>>();

  for (const walk of walks) {
    let previous: string | null = null;
    for (const path of walk) {
      if (previous !== null) {
        const destinations = transitions.get(previous) ?? new Set<string>();
        destinations.add(path);
        transitions.set(previous, destinations);
      }
      previous = path;
    }
  }

  return transitions;
}

function surfaceVersionOf(sessions: readonly SessionTimeline[], surface: string): number | null {
  const versions = sessions
    .flatMap((session) => session.events)
    .filter((event) => event.urlPath === surface)
    .map((event) => event.urlPathNormalisationVersion);

  const [first] = versions;
  return versions.every((version) => version === first) ? (first ?? null) : null;
}

export function detectFunnelDropoff(
  corpus: DetectorCorpus,
  ruleSet: ThresholdRuleSet,
): DetectorResult {
  const { kept, coverage } = analysedSessions(corpus);
  const walks = kept.map(pathWalk);

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
      surfaceNormalisationVersion: surfaceVersionOf(kept, origin),
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
