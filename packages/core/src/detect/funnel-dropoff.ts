// The `funnel_dropoff` detector. Operates over path transitions, consecutive distinct
// `url_path` values in the ordered timeline, whatever the events are named: there is no
// event-name literal in this file, and a grep test asserts there never is. Emits at
// most one candidate per origin, and every magnitude it compares against arrives on the
// rule-set parameter.
// Design rationale: docs/decisions/0009-funnel-dropoff-detector.md
import { measuredCount } from "../counts/measured-count";
// The unit of the percent scale, not a magnitude: a named constant, shared with
// `evidence/predicates.ts` so the two integer-percent comparisons in this package can
// never drift to different scales. Every magnitude this detector compares against
// arrives on the rule-set parameter.
import { PERCENT_SCALE } from "../counts/percent";
import type { EvidenceSignal } from "../evidence/signals";
import type { ThresholdRuleSet } from "../rules/types";
import { analysedSessions } from "./analysed";
import { orderTimeline } from "./order";
import type { DetectorCandidate, DetectorCorpus, DetectorResult, SessionTimeline } from "./types";

/**
 * The step from a walk position to the position immediately after it. Where "anywhere
 * after the first visit to the origin" begins (below).
 *
 * A position offset, not a magnitude and not a threshold; every magnitude this detector
 * compares against still arrives on the rule-set parameter. It has a name, and a home
 * outside every function body, for the same reason `PERCENT_SCALE` has one at
 * `src/counts/percent.ts`: `purity.test.ts` scans function regions only, and counts a
 * bare offset or index inside one as the same offence as a bare threshold. Precisely so
 * no number in a detector body goes unexplained.
 */
const AFTER_FIRST_VISIT_OFFSET = 1;

/**
 * A session's ordered path walk: `null`-path events removed, consecutive repeats of one
 * path collapsed.
 *
 * The collapse is what makes a transition mean "the user moved to a different path":
 * three events on one path are one visit, not two transitions to itself. A
 * `null`-path event takes part in no transition and must not fragment the walk around
 * it into two. It is simply absent here, and counted into
 * `coverage.eventsWithoutUrlPath` instead.
 *
 * A redaction-collapsed path (`/orders/:id`) arrives as one string from
 * `normaliseUrlPath` upstream, so it is one surface here by construction, not by a
 * special case.
 */
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

/**
 * Every transition observed across the kept walks, as origin -> destinations.
 *
 * Insertion-ordered, and the walks arrive in corpus order, so the candidate order this
 * produces is deterministic without a sort, which matters because asks for
 * byte-identical output across two calls, and a comparator is one more thing that could
 * depend on something it should not.
 */
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

/**
 * Which `normaliseUrlPath` version produced this surface.
 *
 * `null` when the kept sessions disagree, or when any event carrying the surface was
 * written before versions were recorded. `null` means "redaction status unknown" and is
 * never coerced to `0`: reporting one version when two produced the string would assert
 * a redaction guarantee this run cannot make.
 */
function surfaceVersionOf(sessions: readonly SessionTimeline[], surface: string): number | null {
  const versions = sessions
    .flatMap((session) => session.events)
    .filter((event) => event.urlPath === surface)
    .map((event) => event.urlPathNormalisationVersion);

  const [first] = versions;
  return versions.every((version) => version === first) ? (first ?? null) : null;
}

/**
 * Emits, per origin (— this once emitted per `(origin, destination)` transition; see
 * the design doc), the sessions that reached that origin and left it
 * without going anywhere they could have gone, as a `MeasuredCount` over sessions.
 *
 * Contract:
 * The rule set arrives as a parameter; nothing here reads `CURRENT_*`;
 * The denominator is `corpus.basis.kept`. Sessions with `exclusion_reason = 'none'`. A
 *  set-aside session reaches no numerator and inflates no denominator;
 * Boundaries are inclusive: an origin fires at `dropped * 100 >=
 *  ruleSet.funnelDropoffRateThresholdPercent * reachedOrigin`, and only when
 *  `reachedOrigin >= ruleSet.funnelMinSessionsAtOrigin` and `dropped >=
 *  ruleSet.funnelMinDropoffSessions`;
 * Events with a `null` `urlPath` take part in NO transition and are counted into
 *  `coverage.eventsWithoutUrlPath`. Over the kept sessions only, the same
 *  population `error_event` counts over, so the two detectors' coverage numbers are
 *  comparable within one run;
 * A redaction-collapsed path (`/orders/:id`) is one surface, not an anomaly;
 * A single-event session yields no transitions; a one-step funnel yields an
 *  empty result, not an error;
 * `corpus.coverage.truncated` propagates onto every candidate;
 * Zero sessions yields an empty result whose `connectionState` distinguishes "we looked
 *  and found nothing" from "we have never looked".
 *
 * What it proposes, and why it is not the failure class: this detector observes
 * navigation, never failure. There is no status code and no network-request property on
 * an event, so it structurally cannot produce a correlated-failure signal.
 * Proposing the failure class would be proposing one it can never prove, a guaranteed
 * downgrade manufactured by the proposal itself. What path transitions can evidence is
 * struggle, which is `confusing`'s proof. The consequence is deliberate: a bare
 * drop-off with no struggle proposes `confusing`, fails its predicate, hits the floor,
 * and is dropped. Silence is the correct output there.
 *
 * Pure: no I/O, no ambient clock, no randomness. The only instants it reads are
 * `corpus.window` and the events' own `occurredAt`. There is no `now` parameter because
 * nothing here needs one, which is the strongest form of "no clock".
 */
export function detectFunnelDropoff(
  corpus: DetectorCorpus,
  ruleSet: ThresholdRuleSet,
): DetectorResult {
  // and in one call, deliberately (PL rulings 7, 16 and 24):
  // `kept` applies here in the tested pure layer. A set-aside session
  //  never had the opportunity to convert, so it reaches neither a numerator
  //  nor the denominator;
  // `coverage.truncated` propagates (a fact about the read);
  // `coverage.eventsWithoutUrlPath` is recomputed over those kept sessions
  //  and nothing else, so it means the same thing here as it does in
  //  `error-event.ts`. Taking the two from one call is what stops the two
  //  detectors reporting coverage on different populations again.
  const { kept, coverage } = analysedSessions(corpus);
  const walks = kept.map(pathWalk);

  const candidates: DetectorCandidate[] = [];

  // One candidate per origin, aggregating across destinations: one stuck surface is
  // one problem, and `dropped` means "left the origin without going anywhere it could
  // have gone". A session's visit to the origin is its first occurrence in the walk,
  // so the count under-detects, the house fail direction. Each sub-rule below is
  // pinned by a named test in `funnel-dropoff.test.ts`.
  // Design rationale: docs/decisions/0009-funnel-dropoff-detector.md
  for (const [origin, rawDestinations] of transitionsOf(walks)) {
    // Enforced explicitly though inert while `pathWalk` collapses consecutive repeats
    // (see the design doc): it states the meaning decision in code, and it is the
    // guard if that collapse ever changes.
    const destinations = new Set(
      [...rawDestinations].filter((destination) => destination !== origin),
    );

    // Nowhere reachable from this origin, so nothing to assert.
    if (!destinations.size) continue;

    const atOrigin = walks.filter((walk) => walk.includes(origin));

    // Under-detect: a denominator this thin cannot support a rate claim to a founder,
    // however extreme the ratio looks.
    if (atOrigin.length < ruleSet.funnelMinSessionsAtOrigin) continue;

    // Measured from the walk's first occurrence of the origin. A session "continues"
    // if, anywhere after that first occurrence, it reaches a member of `destinations`,
    // never checked from a later occurrence, which would shrink the window and
    // manufacture drop-offs out of sessions that plainly went somewhere.
    const dropped = atOrigin.filter((walk) => {
      const firstVisit = walk.indexOf(origin);
      return !walk
        .slice(firstVisit + AFTER_FIRST_VISIT_OFFSET)
        .some((path) => destinations.has(path));
    });

    // Under-detect: the absolute floor beneath the rate.
    if (dropped.length < ruleSet.funnelMinDropoffSessions) continue;

    // Inclusive, in exact integer arithmetic (PL rulings 1 and 15): the comparison is
    // between the two numerators, so the rate means the step attrition the magnitude
    // was calibrated against.
    if (
      dropped.length * PERCENT_SCALE <
      ruleSet.funnelDropoffRateThresholdPercent * atOrigin.length
    ) {
      continue;
    }

    const countOf = (numerator: number) =>
      measuredCount({
        numerator,
        // Kept sessions, on both counts, so can render "5 of 28 sessions" from either
        // one.
        denominator: corpus.basis.kept,
        unit: "sessions",
        timeframe: corpus.window,
        basis: corpus.basis,
      });

    // `repeated_attempt` only, gated inclusively on the rule set's minimum. `backtrack`
    // has no producer and must not gain one here: a single back-navigation fires on a
    // superset of its target. Two magnitudes, not interchangeable: `attempts` is the
    // per-session maximum number of visits, `strugglingSessions` is the cohort of kept
    // sessions that reached that minimum, and the proof predicate gates on the cohort.
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
        // /: the one number the gate's only reachable pass turns on travels with its
        // denominator, like every other count here.
        strugglingSessions: countOf(strugglingSessions),
      });
    }

    candidates.push({
      detector: "funnel_dropoff",
      claimedClass: "confusing",
      // : stated in the type, not only implied by `surface` being non-optional.
      claimSubject: "surface",
      // The origin path. Where the user got stuck, and the surface a fix targets.
      surface: origin,
      surfaceNormalisationVersion: surfaceVersionOf(kept, origin),
      signals,
      // Declared order: [0] reached the origin, [1] left it without going anywhere it
      // could have gone (— this used to read "did not reach the destination"; the order
      // survives, only the second count's meaning changed).
      counts: [countOf(atOrigin.length), countOf(dropped.length)],
      timeframe: corpus.window,
      // The run's coverage travels with the claim, not beside it in a log. The That
      // decision was a silent truncation that read as "no more events".
      coverage,
    });
  }

  return {
    detector: "funnel_dropoff",
    //  vs: an empty candidate list is a real answer, and this is what stops
    // "we looked and found nothing" reading like "we have never looked".
    connectionState: corpus.connectionState,
    coverage,
    candidates,
  };
}
