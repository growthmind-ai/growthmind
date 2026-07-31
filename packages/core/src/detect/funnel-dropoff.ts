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
 * Emits, per observed path transition, the sessions that reached the origin
 * path and did not reach the destination, as a `MeasuredCount` over SESSIONS.
 *
 * Contract:
 * - the rule set arrives as a PARAMETER; nothing here reads `CURRENT_*` (D-14);
 * - the denominator is `corpus.basis.kept` — sessions with
 *   `exclusion_reason = 'none'` (D-7, FR-7). A set-aside session reaches no
 *   numerator and inflates no denominator;
 * - boundaries are INCLUSIVE: a transition fires at
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

  for (const [origin, destinations] of transitionsOf(walks)) {
    const atOrigin = walks.filter((walk) => walk.includes(origin));

    // UNDER-DETECT (FR-9): a denominator this thin cannot support a rate claim
    // to a founder, however extreme the ratio looks. Checked per origin, so it
    // silences every destination reached from it.
    if (atOrigin.length < ruleSet.funnelMinSessionsAtOrigin) continue;

    for (const destination of destinations) {
      // "Did not reach the destination anywhere in the session" — the
      // conservative reading. A session that saw the destination before the
      // origin is not counted as having dropped out of it.
      const dropped = atOrigin.filter((walk) => !walk.includes(destination));

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

      // PL ruling 18: `repeated_attempt` ONLY, gated inclusively on the
      // rule set's minimum. `backtrack` has NO producer this sprint and must
      // not gain one here: users navigate back constantly, so a single
      // back-navigation fires on a superset of its target — the D10
      // conflation this sprint exists to prevent.
      //
      // The magnitude is per-session (the rule-set comment reads "two visits
      // to a path is navigation; three is a pattern"), aggregated as the
      // greatest number of separate visits any one kept session made to this
      // surface.
      const attempts = Math.max(
        ...atOrigin.map((walk) => walk.filter((path) => path === origin).length),
      );
      const signals: EvidenceSignal[] = [];
      if (attempts >= ruleSet.struggleRepeatedAttemptMin) {
        signals.push({
          kind: "struggle",
          subkind: "repeated_attempt",
          surface: origin,
          attempts,
        });
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

      // ── OPEN CONTRACT QUESTION (label: ESC-9). READ BEFORE CONSUMING THIS. ─
      //
      // STATED IN FULL HERE. This comment and the matching block in
      // `funnel-dropoff.test.ts` ARE the record — `ESC-9` is a label for
      // cross-referencing the two, not a pointer to a register that resolves
      // it elsewhere. Nothing below depends on reading another document.
      //
      // This loop emits ONE CANDIDATE PER `(origin, destination)` TRANSITION,
      // and `DetectorCandidate` CARRIES NO DESTINATION. `destination` is used
      // to compute `dropped` and is then discarded.
      //
      // The consequence, stated plainly because it is invisible from the type:
      // every candidate from one origin serialises to a BYTE-IDENTICAL
      // `evidence_shape`. `serialiseV1` reads `{v, detector, surface,
      // surfaceNormalisationVersion, signalKinds, symptomClass}` — all six are
      // fixed by the origin, and magnitudes are excluded from identity by
      // design (D-12). So an origin leaking to three destinations above
      // threshold yields THREE CANDIDATES AND ONE IDENTITY.
      //
      // That is harmless TODAY for one reason only, stated here rather than
      // referenced: NOTHING CONSUMES THESE CANDIDATES YET. The detector→gate
      // pipeline has no production caller this sprint — neither `apps/web` nor
      // `worker` depends on `@growthmind/core` — so no ledger, no delivery and
      // no stored finding reads an `evidence_shape`. Wiring that caller is
      // O-005's job, and O-005 must resolve the question below BEFORE it does.
      //
      // It becomes a defect the moment O-006 hashes `evidence_shape` into its
      // signature: the ledger either suppresses N−1 real findings as
      // duplicates, or a founder sees N visually identical findings differing
      // only by a number they cannot attribute to anything.
      //
      // IT IS DELIBERATELY NOT RESOLVED HERE, because the two fixes encode
      // different products and both change a contract O-005 and O-006 build
      // against:
      //   (a) carry `destination` into the candidate and into a v2 serialiser
      //       — N destinations are N problems; or
      //   (b) emit ONE candidate per origin, aggregating across destinations —
      //       one stuck surface is one problem, which is what ruling 14's
      //       "the surface a fix targets" points at, but which makes ruling
      //       15's second count ("did not reach the destination") ambiguous.
      //
      // Guessing here would lock three downstream outcomes to the wrong shape,
      // so the decision is OPEN and this comment is where it is recorded —
      // there is no register elsewhere holding a resolution. It is owed by
      // whoever first consumes a candidate (O-005) or first hashes an
      // `evidence_shape` (O-006), whichever lands sooner.
      // `funnel-dropoff.test.ts` pins the CURRENT behaviour so whichever way it
      // lands is a visible, failing-test change rather than a silent one.
      candidates.push({
        detector: "funnel_dropoff",
        claimedClass: "confusing",
        // PL ruling 14: the ORIGIN path — where the user got stuck, and the
        // surface a fix targets.
        surface: origin,
        surfaceNormalisationVersion: surfaceVersionOf(kept, origin),
        signals,
        // PL ruling 15, declared order: [0] reached the origin,
        // [1] did not reach the destination.
        counts: [countOf(atOrigin.length), countOf(dropped.length)],
        timeframe: corpus.window,
        // D-3: the run's coverage travels WITH the claim, not beside it in a
        // log — O-003's CR-1 was a silent truncation that read as "no more
        // events".
        coverage,
      });
    }
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
