import type { ExclusionReason } from "@growthmind/shared";

import type { DetectorCorpus, DetectorCoverage, SessionTimeline } from "./types";

const KEPT: ExclusionReason = "none";

export type AnalysedSessions = {
  readonly kept: readonly SessionTimeline[];
  readonly coverage: DetectorCoverage;
};

export function analysedSessions(corpus: DetectorCorpus): AnalysedSessions {
  const kept = corpus.sessions.filter((session) => session.exclusionReason === KEPT);

  return {
    kept,
    coverage: {
      truncated: corpus.coverage.truncated,
      eventsWithoutUrlPath: kept
        .flatMap((session) => session.events)
        .filter((event) => event.urlPath === null).length,
    },
  };
}
