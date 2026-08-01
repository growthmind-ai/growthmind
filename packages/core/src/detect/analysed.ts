// The one definition of "what this run actually analysed" (PL rulings 7, 16 and 24).
//
// Wave 4 built the two detectors in parallel and they diverged here: `error_event`
// recomputed `coverage.eventsWithoutUrlPath` over the KEPT sessions, `funnel_dropoff`
// over every session it was handed. Two detectors reporting coverage on different
// denominators makes the number uncomparable across a run. A defect, and exactly the
// kind that reads as a product problem rather than a bug.
//
// settled it: KEPT sessions only, in both. Coverage must describe what was actually
// analysed, and a set-aside session is never analysed.
//
// This module makes the two agree by construction rather than by two comments promising
// the same thing: it returns the kept set and the coverage computed over exactly that
// set, together, from one call. A detector cannot take one without the other, so there
// is no longer a seam for the denominators to drift apart along.
import type { ExclusionReason } from "@growthmind/shared";

import type { DetectorCorpus, DetectorCoverage, SessionTimeline } from "./types";

/** The analysed set is the sessions whose exclusion reason is this one. */
const KEPT: ExclusionReason = "none";

/** The kept sessions and the coverage OF those sessions. Inseparable, so the two can
 * never describe different populations. */
export type AnalysedSessions = {
  readonly kept: readonly SessionTimeline[];
  readonly coverage: DetectorCoverage;
};

/**
 * Applies and derives the coverage from the result.
 *
 * `kept`, sessions with `exclusion_reason = 'none'` (the corpus hands over every
 *  selected session carrying its own reason, and the detector applies the rule, so
 *  That decision is asserted against this tested pure layer rather than against an
 *  untested SQL read). A set-aside session reaches no numerator and inflates no
 *  denominator.
 * `coverage.truncated`, propagates from the corpus. It is a fact about the read and
 *  cannot be recomputed from the sessions.
 * `coverage.eventsWithoutUrlPath`, recomputed over the KEPT sessions only (PL rulings
 *  16 and 24), so the number is provably about what this run analysed rather than
 *  about what someone upstream believed, and means the same thing whichever detector
 *  reports it.
 *
 * Pure: no I/O, no clock, no randomness. No node builtin.
 */
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
