// The ONE definition of "what this run actually analysed" (FR-7, D-3, PL
// rulings 7, 16 and 24).
//
// Wave 4 built the two detectors in parallel and they diverged here:
// `error_event` recomputed `coverage.eventsWithoutUrlPath` over the KEPT
// sessions, `funnel_dropoff` over EVERY session it was handed. Two detectors
// reporting coverage on different denominators makes the number uncomparable
// across a run — a D5 defect, and exactly the kind that reads as a product
// problem rather than a bug.
//
// PL ruling 24 settled it: KEPT SESSIONS ONLY, in both. Coverage must describe
// what was actually ANALYSED, and a set-aside session is never analysed.
//
// This module makes the two agree BY CONSTRUCTION rather than by two comments
// promising the same thing: it returns the kept set and the coverage computed
// over exactly that set, together, from one call. A detector cannot take one
// without the other, so there is no longer a seam for the denominators to
// drift apart along.
import type { ExclusionReason } from "@growthmind/shared";

import type { DetectorCorpus, DetectorCoverage, SessionTimeline } from "./types";

/** FR-7: the analysed set is the sessions whose exclusion reason is this one. */
const KEPT: ExclusionReason = "none";

/** The kept sessions and the coverage OF those sessions — inseparable, so the
 * two can never describe different populations. */
export type AnalysedSessions = {
  readonly kept: readonly SessionTimeline[];
  readonly coverage: DetectorCoverage;
};

/**
 * Applies FR-7 and derives D-3's coverage from the result.
 *
 * - `kept` — sessions with `exclusion_reason = 'none'` (FR-7, PL ruling 7: the
 *   corpus hands over every selected session carrying its own reason, and the
 *   DETECTOR applies the rule, so FR-7 is asserted against this tested pure
 *   layer rather than against an untested SQL read). A set-aside session
 *   reaches no numerator and inflates no denominator.
 * - `coverage.truncated` — PROPAGATES from the corpus (PL ruling 16). It is a
 *   fact about the READ and cannot be recomputed from the sessions.
 * - `coverage.eventsWithoutUrlPath` — RECOMPUTED over the KEPT sessions only
 *   (PL rulings 16 and 24), so the number is provably about what this run
 *   analysed rather than about what someone upstream believed, and means the
 *   same thing whichever detector reports it.
 *
 * PURE: no I/O, no clock, no randomness (FR-5). No node builtin (D-13).
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
