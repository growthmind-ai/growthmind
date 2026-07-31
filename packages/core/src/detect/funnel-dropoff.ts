// The `funnel_dropoff` detector (O-004 FR-1, D-18).
//
// Operates over PATH TRANSITIONS — consecutive distinct `url_path` values in
// the ordered timeline — whatever the events are named. There is no event-name
// literal in this file at all, and a grep test asserts there never is.
//
// Why: Addendum A ROW A-5 came back FAILED-TO-PIN, so a detector keyed on a
// page-view event name would be built on an unpinned assumption. It does not
// need to be. The adapter reads `$pathname`/`$current_url` on EVERY event, so
// `url_path` is populated wherever the SDK sends it, regardless of event name.
// If a real project turns out to populate `url_path` on nothing, this detector
// degrades to an empty result with `coverage.eventsWithoutUrlPath` telling the
// honest story (ES-4, BS-4) — a visible degradation, not a silent one.
//
// This detector may not propose the class a clean exit would satisfy (D-9):
// its `claimedClass` is constrained by `DetectorProposedClass`, and the
// literal for that class appears nowhere under `src/detect/`.
import { measuredCount } from "../counts/measured-count";
// The unit of the percent scale, NOT a magnitude (FR-8, PL ruling 26): a NAMED
// constant, shared with `evidence/predicates.ts` so the two integer-percent
// comparisons in this package can never drift to different scales. Every
// magnitude this detector compares against arrives on the rule-set parameter.
import { PERCENT_SCALE } from "../counts/percent";
import type { EvidenceSignal } from "../evidence/signals";
import type { ThresholdRuleSet } from "../rules/types";
import { analysedSessions } from "./analysed";
import { orderTimeline } from "./order";
import type { DetectorCandidate, DetectorCorpus, DetectorResult, SessionTimeline } from "./types";

/**
 * The step from a walk position to the position IMMEDIATELY AFTER it — where
 * "anywhere after the first visit to the origin" begins (D-2a, below).
 *
 * A position offset, not a magnitude and not a threshold; every magnitude this
 * detector compares against still arrives on the rule-set parameter. It has a
 * NAME, and a home outside every function body, for the same reason
 * `PERCENT_SCALE` has one at `src/counts/percent.ts` (FR-8, PL ruling 26):
 * `purity.test.ts` scans function regions only, and counts a bare offset or
 * index inside one as the same offence as a bare threshold — precisely so no
 * number in a detector body goes unexplained.
 */
const AFTER_FIRST_VISIT_OFFSET = 1;

/**
 * A session's ordered path walk: `null`-path events removed, consecutive
 * repeats of one path collapsed.
 *
 * The collapse is what makes a transition mean "the user moved to a DIFFERENT
 * path": three events on one path are one visit, not two transitions to itself
 * (ES-5). A `null`-path event takes part in no transition and must not
 * fragment the walk around it into two (ES-4, BS-4) — it is simply absent
 * here, and counted into `coverage.eventsWithoutUrlPath` instead.
 *
 * A redaction-collapsed path (`/orders/:id`) arrives as ONE string from
 * `normaliseUrlPath` upstream, so it is one surface here by construction, not
 * by a special case (ES-11).
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
 * Every transition observed across the KEPT walks, as origin -> destinations.
 *
 * Insertion-ordered, and the walks arrive in corpus order, so the candidate
 * order this produces is deterministic without a sort — which matters because
 * FR-5 asks for byte-identical output across two calls, and a comparator is
 * one more thing that could depend on something it should not.
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
 * Which `normaliseUrlPath` version produced this surface (D-15, FR-18, ES-14).
 *
 * `null` when the kept sessions disagree, or when any event carrying the
 * surface was written before versions were recorded. `null` means "redaction
 * status unknown" and is NEVER coerced to `0`: reporting one version when two
 * produced the string would assert a redaction guarantee this run cannot make.
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
 * Emits, per ORIGIN (O-005 D-2 — this ONCE emitted per `(origin, destination)`
 * TRANSITION; see the resolution record below), the sessions that reached
 * that origin and left it without going anywhere they could have gone, as a
 * `MeasuredCount` over SESSIONS.
 *
 * Contract:
 * - the rule set arrives as a PARAMETER; nothing here reads `CURRENT_*` (D-14);
 * - the denominator is `corpus.basis.kept` — sessions with
 *   `exclusion_reason = 'none'` (D-7, FR-7). A set-aside session reaches no
 *   numerator and inflates no denominator;
 * - boundaries are INCLUSIVE: an origin fires at
 *   `dropped * 100 >= ruleSet.funnelDropoffRateThresholdPercent * reachedOrigin`,
 *   and only when `reachedOrigin >= ruleSet.funnelMinSessionsAtOrigin` and
 *   `dropped >= ruleSet.funnelMinDropoffSessions` (D-6, FR-9);
 * - events with a `null` `urlPath` take part in NO transition and are counted
 *   into `coverage.eventsWithoutUrlPath` (ES-4, BS-4) — over the KEPT sessions
 *   only, the same population `error_event` counts over (PL ruling 24), so the
 *   two detectors' coverage numbers are comparable within one run;
 * - a redaction-collapsed path (`/orders/:id`) is ONE surface, not an anomaly
 *   (ES-11);
 * - a single-event session yields no transitions (ES-3); a one-step funnel
 *   yields an empty result, not an error (ES-5);
 * - `corpus.coverage.truncated` propagates onto EVERY candidate (D-3);
 * - zero sessions yields an empty result whose `connectionState` distinguishes
 *   "we looked and found nothing" from "we have never looked" (ES-1, ES-8).
 *
 * WHAT IT PROPOSES, and why it is not the failure class (PL ruling 13): this
 * detector observes NAVIGATION, never failure. There is no status code and no
 * network-request property on an event (A-6), so it structurally cannot
 * produce a correlated-failure signal — proposing the failure class would be
 * proposing one it can never prove, a guaranteed downgrade manufactured by the
 * proposal itself. What path transitions CAN evidence is struggle, which is
 * `confusing`'s proof. The consequence is deliberate: a bare drop-off with no
 * struggle proposes `confusing`, fails its predicate, hits FR-13B's floor, and
 * is dropped. Silence is the correct output there (ADD trade-off 6, ESC-1).
 *
 * PURE: no I/O, no ambient clock, no randomness (FR-5). The only instants it
 * reads are `corpus.window` and the events' own `occurredAt` — there is no
 * `now` parameter because nothing here needs one, which is the strongest form
 * of "no clock".
 */
export function detectFunnelDropoff(
  corpus: DetectorCorpus,
  ruleSet: ThresholdRuleSet,
): DetectorResult {
  // FR-7 and D-3 in ONE call, deliberately (PL rulings 7, 16 and 24):
  //  - `kept` applies FR-7 here in the tested pure layer — a set-aside session
  //    never had the opportunity to convert, so it reaches neither a numerator
  //    nor the denominator;
  //  - `coverage.truncated` propagates (a fact about the read);
  //  - `coverage.eventsWithoutUrlPath` is recomputed over THOSE KEPT SESSIONS
  //    and nothing else, so it means the same thing here as it does in
  //    `error-event.ts`. Taking the two from one call is what stops the two
  //    detectors reporting coverage on different populations again.
  const { kept, coverage } = analysedSessions(corpus);
  const walks = kept.map(pathWalk);

  const candidates: DetectorCandidate[] = [];

  // ── ESC-9 RESOLUTION RECORD (O-005 D-2). ────────────────────────────────
  //
  // ESC-9 asked which of two fixes to take: (a) carry `destination` into the
  // candidate and a v2 serialiser — N destinations are N problems; or (b)
  // emit ONE candidate per origin, aggregating across destinations — one
  // stuck surface is one problem. O-005 D-2 TAKES FIX (b), and this loop now
  // emits AT MOST ONE candidate per origin. `DetectorCandidate` carries no
  // destination, and none is needed: fix (b) resolves BOTH of ESC-9's
  // halves at once — one identity (one `evidence_shape` per origin, closing
  // the O-006 collision), and one count whose MEANING is now "left the
  // origin without going anywhere it could have gone" rather than "did not
  // reach THIS destination" (which is what produced ESC-9's rate-inflation
  // half — a healthy branching hub reporting "20 of 30 did not reach here"
  // three times over, once per destination it never claimed).
  //
  // THREE SUB-RULES THE PRD LEFT OPEN, each DECIDED here and each PINNED by a
  // test that NAMES it, so a reader can grep the rule and land on its proof.
  // In `funnel-dropoff.test.ts`, verbatim:
  //
  //   `D-2a — the dropped and struggling cohorts are structurally disjoint`
  //   `D-2b — the self-transition filter is unreachable while pathWalk collapses consecutive repeats`
  //   `D-2c — an origin whose destination set is empty emits no candidate`
  //
  // D-2a's test pins a CONSEQUENCE of the first-visit choice rather than the
  // choice itself — under first-visit semantics a dropped session visited the
  // origin exactly once, so the dropped and struggling cohorts can never
  // overlap. Reverse D-2a and that test is what fails.
  //
  //   D-2a — a session's visit to the origin is its FIRST occurrence in the
  //   ordered walk. Maximises the window in which a session can be seen to
  //   continue, so it maximises `continued` and minimises `dropped`.
  //   FAIL DIRECTION: UNDER-DETECT — the house direction, and the direction
  //   every member of `ThresholdRuleSet` is documented in.
  //
  //   D-2b — the origin is NOT a member of its own destination set. As a
  //   statement of MEANING this is a real decision: counting a return to the
  //   origin as "going somewhere it could have gone" would be false to the
  //   sentence FR-2 gives P-2, "left this page without going anywhere it
  //   could have gone".
  //
  //   AS CODE, THE FILTER BELOW IS INERT — say that plainly rather than
  //   dress it up, and note that it is inert under ANY visit-selection
  //   semantics, not merely D-2a's. `pathWalk` pushes a path only when it
  //   differs from the previous one, so no walk carries two adjacent equal
  //   entries; `transitionsOf` pairs only ADJACENT entries. An origin can
  //   therefore never be its own immediate successor, the filter removes
  //   nothing, and no candidate, count or fail direction changes. It is not
  //   over-detect relative to D-2a; it has no detect direction at all. The
  //   test named above pins exactly this, on a fixture carrying BOTH shapes
  //   that could produce a self-transition — an `origin → detour → origin`
  //   return, and a consecutive run of raw events on the origin.
  //
  //   THE PROPERTY BELONGS TO `pathWalk`'s COLLAPSE (`pathWalk`, above) AND
  //   TO NOTHING ELSE — in particular NOT to where `dropped` is measured
  //   from. (ESC-16, whether `dropped` runs from the origin's FIRST visit as
  //   D-2a implements via `walk.indexOf` or from its LAST, is open; it does
  //   not bear on this filter, which is inert either way. An earlier draft of
  //   this comment claimed ESC-16 was the reason to keep the filter. It was
  //   wrong, and it is recorded here so the claim is not re-derived.)
  //
  //   IT IS KEPT ANYWAY, FOR TWO REASONS:
  //     - it states the D-2b MEANING decision in code, where it is read and
  //       reviewed, instead of leaving it implicit in a property of
  //       `pathWalk` that a future edit could remove without anyone noticing
  //       this detector was relying on it;
  //     - it is the guard that BECOMES load-bearing if that collapse changes.
  //       Relax the collapse and `origin → origin` becomes expressible, at
  //       which point this filter is the only thing stopping a return to the
  //       origin from counting as somewhere the user "could have gone".
  //
  //   D-2c — an origin whose destination set is empty emits no candidate.
  //   With nowhere reachable, "did not go anywhere it could have gone" is
  //   VACUOUS, and asserting it would claim a drop-off on every exit page in
  //   the product.
  //
  // CONTAINMENT WARNING, CARRIED FORWARD (PM Ruling 1, ADD D-2): before this
  // fix, the hub defect was contained ONLY by ruling 13's designed silence
  // (`struggleMinStrugglingSessions`) — a healthy hub still produced THREE
  // rate-inflated candidates, and it was only because none carried a
  // qualifying `struggle` signal that the GATE silently downgraded and
  // dropped them. That containment was never about the count being right.
  // After this aggregation, the count IS right — a healthy hub now emits at
  // most ONE candidate whose `dropped` count is honest — and that is pinned by
  // a hub fixture asserting a LITERAL `toHaveLength(1)`, never merely iterated
  // over, rather than left to the gate's luck. Grep `funnel-dropoff.test.ts`
  // for the test
  // `ESC-9 fix (b) — a firing hub emits exactly one candidate for the origin`.
  for (const [origin, rawDestinations] of transitionsOf(walks)) {
    // D-2b, enforced explicitly though inert while `pathWalk` collapses
    // consecutive repeats (resolution record above): it states the meaning
    // decision in code, and it is the guard if that collapse ever changes.
    const destinations = new Set(
      [...rawDestinations].filter((destination) => destination !== origin),
    );

    // D-2c: nowhere reachable from this origin, so nothing to assert.
    if (!destinations.size) continue;

    const atOrigin = walks.filter((walk) => walk.includes(origin));

    // UNDER-DETECT (FR-9): a denominator this thin cannot support a rate claim
    // to a founder, however extreme the ratio looks.
    if (atOrigin.length < ruleSet.funnelMinSessionsAtOrigin) continue;

    // D-2a: measured from the walk's FIRST occurrence of the origin. A
    // session "continues" if, anywhere after that first occurrence, it
    // reaches a member of `destinations` — never checked from a LATER
    // occurrence, which would shrink the window and manufacture drop-offs
    // out of sessions that plainly went somewhere.
    const dropped = atOrigin.filter((walk) => {
      const firstVisit = walk.indexOf(origin);
      return !walk
        .slice(firstVisit + AFTER_FIRST_VISIT_OFFSET)
        .some((path) => destinations.has(path));
    });

    // UNDER-DETECT (FR-9): the absolute floor beneath the rate.
    if (dropped.length < ruleSet.funnelMinDropoffSessions) continue;

    // D-6, INCLUSIVE, in exact integer arithmetic (PL rulings 1 and 15): the
    // comparison is between the two NUMERATORS, so the rate means the step
    // attrition FR-9's magnitude was calibrated against.
    if (
      dropped.length * PERCENT_SCALE <
      ruleSet.funnelDropoffRateThresholdPercent * atOrigin.length
    ) {
      continue;
    }

    const countOf = (numerator: number) =>
      measuredCount({
        numerator,
        // D-7: kept sessions, on BOTH counts, so O-007 can render
        // "5 of 28 sessions" from either one.
        denominator: corpus.basis.kept,
        unit: "sessions",
        timeframe: corpus.window,
        basis: corpus.basis,
      });

    // PL ruling 18: `repeated_attempt` ONLY, gated inclusively on the
    // rule set's minimum. `backtrack` has NO producer this sprint and must
    // not gain one here: users navigate back constantly, so a single
    // back-navigation fires on a superset of its target — the D10
    // conflation this sprint exists to prevent. PL ruling 36 closed the same
    // door on the CONSUMING side — `backtrack` is not admissible proof of
    // anything — so "no producer" is no longer the only guard.
    //
    // TWO MAGNITUDES, AND THEY ARE NOT INTERCHANGEABLE.
    //
    //  - `attempts` is PER-SESSION (PL ruling 31): the greatest number of
    //    separate visits any ONE kept session made to this surface. That is
    //    what the rule-set comment "two visits is navigation; three is a
    //    pattern" is a statement about.
    //  - `strugglingSessions` is the COHORT: how many kept sessions at this
    //    origin individually reached that per-session minimum, over
    //    `basis.kept`.
    //
    // The signal carries both because the maximum ALONE is a claim about the
    // corpus SIZE rather than about the surface: it only ever rises as more
    // sessions are read, so at `DETECTOR_CORPUS_MAX_SESSIONS` one outlier
    // would speak for five hundred. The proof predicate gates on the cohort
    // (`struggleMinStrugglingSessions`); `attempts` stays the number a
    // founder reads, and is honest because the signal now only exists when a
    // real cohort struggled.
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
        // D-7 / §10: the one number the gate's only reachable pass turns on
        // travels WITH its denominator, like every other count here.
        strugglingSessions: countOf(strugglingSessions),
      });
    }

    candidates.push({
      detector: "funnel_dropoff",
      claimedClass: "confusing",
      // O-005 D-5, ESC-6: stated in the type, not only implied by `surface`
      // being non-optional.
      claimSubject: "surface",
      // PL ruling 14: the ORIGIN path — where the user got stuck, and the
      // surface a fix targets.
      surface: origin,
      surfaceNormalisationVersion: surfaceVersionOf(kept, origin),
      signals,
      // PL ruling 15, declared order: [0] reached the origin, [1] left it
      // without going anywhere it could have gone (O-005 D-2 — this used to
      // read "did not reach the destination"; the ORDER survives, only the
      // SECOND count's meaning changed).
      counts: [countOf(atOrigin.length), countOf(dropped.length)],
      timeframe: corpus.window,
      // D-3: the run's coverage travels WITH the claim, not beside it in a
      // log — O-003's CR-1 was a silent truncation that read as "no more
      // events".
      coverage,
    });
  }

  return {
    detector: "funnel_dropoff",
    // ES-1 vs ES-8: an empty candidate list is a real answer, and this is what
    // stops "we looked and found nothing" reading like "we have never looked".
    connectionState: corpus.connectionState,
    coverage,
    candidates,
  };
}
