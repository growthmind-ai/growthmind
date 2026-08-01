// The `funnel_dropoff` detector.
//
// Operates over path transitions. Consecutive distinct `url_path` values in the ordered
// timeline. Whatever the events are named. There is no event-name literal in this file
// at all, and a grep test asserts there never is.
//
// Why: Addendum a row came back failed-to-pin, so a detector keyed on a page-view
// event name would be built on an unpinned assumption. It does not need to be. The
// adapter reads `$pathname`/`$current_url` on every event, so `url_path` is populated
// wherever the SDK sends it, regardless of event name. If a real project turns out to
// populate `url_path` on nothing, this detector degrades to an empty result with
// `coverage.eventsWithoutUrlPath` telling the honest story. A visible
// degradation, not a silent one.
//
// This detector may not propose the class a clean exit would satisfy: its
// `claimedClass` is constrained by `DetectorProposedClass`, and the literal for that
// class appears nowhere under `src/detect/`.
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
 * the resolution record below), the sessions that reached that origin and left it
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

  // Resolution record.
  //
  // asked which of two fixes to take: carry `destination` into the candidate and a
  // v2 serialiser. N destinations are N problems; or emit one candidate per origin,
  // aggregating across destinations, one stuck surface is one problem. Takes fix,
  // and this loop now emits at most one candidate per origin. `DetectorCandidate`
  // carries no destination, and none is needed: fix resolves both of the halves at
  // once, one identity (one `evidence_shape` per origin, closing the collision), and
  // one count whose meaning is now "left the origin without going anywhere it could
  // have gone" rather than "did not reach this destination" (which is what produced the
  // rate-inflation half. A healthy branching hub reporting "20 of 30 did not reach
  // here" three times over, once per destination it never claimed).
  //
  // Three sub-rules the prd left open, each decided here and each pinned by a test that
  // names it, so a reader can grep the rule and land on its proof. In
  // `funnel-dropoff.test.ts`, verbatim:
  //
  // `D-2a — the dropped and struggling cohorts are structurally disjoint` `D-2b — the
  // self-transition filter is unreachable while pathWalk collapses consecutive repeats`
  // `D-2c — an origin whose destination set is empty emits no candidate`
  //
  // the test pins a consequence of the first-visit choice rather than the choice
  // itself. Under first-visit semantics a dropped session visited the origin exactly
  // once, so the dropped and struggling cohorts can never overlap. Reverse and that
  // test is what fails.
  //
  // A session's visit to the origin is its first occurrence in the ordered walk.
  // Maximises the window in which a session can be seen to continue, so it maximises
  // `continued` and minimises `dropped`. Fail direction: Under-detect, the house
  // direction, and the direction every member of `ThresholdRuleSet` is documented in.
  //
  // What reduces `dropped` TO, and why `destinations` cannot move the number. `D` is
  // not supplied from outside: `transitionsOf` builds it from these same kept walks. So
  // take any walk holding the origin and look at the slice after its first visit:
  //  - if that slice is non-empty, its first entry is by construction an
  //  immediate successor of the origin in this very walk, hence a member
  //  of `rawDestinations`; and it differs from the origin, because
  //  `pathWalk` collapses consecutive repeats — so it survives the
  //  filter and is a member of `destinations`. The `.some` below
  //  therefore succeeds at the first element it tests, whatever else the
  //  set holds;
  //  - if that slice is empty, `.some` is false, whatever the set
  //  holds.
  // `dropped` therefore reduces exactly to "the walk ends at the session's first visit
  // to the origin" (`walk.indexOf(origin) === walk.length - 1`), and the contents of
  // `destinations` cannot change one session's verdict: enlarge the set or shrink it,
  // the count is identical. Read the filter expression below as the reduction, not as a
  // lookup whose answer depends on the set. "reaches a member of `destinations`" is
  // true but reads as though the destination set moves the number, and it does not.
  // Both `purity.test.ts` and `funnel-dropoff.test.ts` state this reduction where they
  // justify their three-cohort fixtures; it is recorded here because this is where a
  // maintainer reads the loop.
  //
  // What `destinations` is still for, then: the emptiness gate below, and nothing in
  // the count. Note that gate is inert as code for the same reason the filter above it
  // is, `transitionsOf` only ever keys an origin that had a successor, so
  // `rawDestinations` is never empty, and no walk carries adjacent repeats, so it never
  // contains the origin and the filter can never empty it. A terminal surface emits
  // nothing because it is never a key of the transition map, not because the `continue`
  // runs. The test pins that outcome, which is what a reader should rely on; the gate,
  // like the filter, states the meaning decision in code and becomes load-bearing the
  // moment either of those two properties changes.
  //
  // The origin is not a member of its own destination set. As a statement of meaning
  // this is a real decision: counting a return to the origin as "going somewhere it
  // could have gone" would be false to the sentence owes a non-technical reader, "left
  // this page without going anywhere it could have gone".
  //
  // As code, the filter below is inert. Say that plainly rather than dress it up, and
  // note that it is inert under any visit-selection semantics, not merely the.
  // `pathWalk` pushes a path only when it differs from the previous one, so no walk
  // carries two adjacent equal entries; `transitionsOf` pairs only adjacent entries. An
  // origin can therefore never be its own immediate successor, the filter removes
  // nothing, and no candidate, count or fail direction changes. It is not over-detect
  // relative to; it has no detect direction at all. The test named above pins exactly
  // this, on a fixture carrying both shapes that could produce a self-transition. An
  // `origin → detour → origin` return, and a consecutive run of raw events on the
  // origin.
  //
  // The property belongs to `pathWalk`'s collapse (`pathWalk`, above) and to nothing
  // else. In particular not to where `dropped` is measured from. (whether `dropped`
  // runs from the origin's first visit as implements via `walk.indexOf` or from its
  // last, is open; it does not bear on this filter, which is inert either way. An
  // earlier draft of this comment claimed That decision was the reason to keep the
  // filter. It was wrong, and it is recorded here so the claim is not re-derived.)
  //
  // It is kept anyway, for two reasons:
  //  - it states the meaning decision in code, where it is read and
  //  reviewed, instead of leaving it implicit in a property of
  //  `pathWalk` that a future edit could remove without anyone noticing
  //  this detector was relying on it;
  //  - it is the guard that becomes load-bearing if that collapse changes.
  //  Relax the collapse and `origin → origin` becomes expressible, at
  //  which point this filter is the only thing stopping a return to the
  //  origin from counting as somewhere the user "could have gone".
  //
  // An origin whose destination set is empty emits no candidate. With nowhere
  // reachable, "did not go anywhere it could have gone" is vacuous, and asserting it
  // would claim a drop-off on every exit page in the product.
  //
  // Containment warning, carried forward: before this fix, the hub defect was contained
  // only by ruling 13's designed silence (`struggleMinStrugglingSessions`). A healthy
  // hub still produced three rate-inflated candidates, and it was only because none
  // carried a qualifying `struggle` signal that the gate silently downgraded and
  // dropped them. That containment was never about the count being right. After this
  // aggregation, the count IS right. A healthy hub now emits at most one candidate
  // whose `dropped` count is honest, and that is pinned by a hub fixture asserting a
  // literal `toHaveLength`, never merely iterated over, rather than left to the
  // gate's luck. Grep `funnel-dropoff.test.ts` for the test ` fix — a firing
  // hub emits exactly one candidate for the origin`.
  for (const [origin, rawDestinations] of transitionsOf(walks)) {
    // Enforced explicitly though inert while `pathWalk` collapses consecutive repeats
    // (resolution record above): it states the meaning decision in code, and it is the
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
    // has NO producer this sprint and must not gain one here: users navigate back
    // constantly, so a single back-navigation fires on a superset of its target. The
    // conflation this sprint exists to prevent. closed the same door on the consuming
    // side, `backtrack` is not admissible proof of anything, so "no producer" is no
    // longer the only guard.
    //
    // Two magnitudes, and they are not interchangeable.
    //
    // `attempts` is per-session: the greatest number of
    //  separate visits any one kept session made to this surface. That is
    //  what the rule-set comment "two visits is navigation; three is a
    //  pattern" is a statement about.
    // `strugglingSessions` is the cohort: how many kept sessions at this
    //  origin individually reached that per-session minimum, over
    //  `basis.kept`.
    //
    // The signal carries both because the maximum alone is a claim about the corpus
    // size rather than about the surface: it only ever rises as more sessions are read,
    // so at `DETECTOR_CORPUS_MAX_SESSIONS` one outlier would speak for five hundred.
    // The proof predicate gates on the cohort (`struggleMinStrugglingSessions`);
    // `attempts` stays the number a founder reads, and is honest because the signal now
    // only exists when a real cohort struggled.
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
