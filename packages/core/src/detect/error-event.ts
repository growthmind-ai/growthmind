// The `error_event` detector (O-004 FR-2, FR-6, D-18, ES-13).
//
// The exception's event name comes from `ruleSet.exceptionEventName`, and the
// names of the events a user did not cause from `ruleSet.passiveEventNames` —
// NO EVENT NAME LITERAL APPEARS IN THIS FILE AT ALL, and a grep test asserts
// it never does (D9). That is what keeps a vendor-vocabulary change a one-line
// rule-set edit plus a version bump instead of a hunt through detector bodies.
//
// What this detector CANNOT see, stated here as well as at the proof
// predicate (ESC-1, BS-1a): the ABSENT request. A save that silently no-ops —
// nothing thrown, no event fired — leaves no trace in this schema at all.
// There is no `properties` column, no status code, and no network-request
// property. A `broken` claim over such a session finds no proof and correctly
// downgrades, then hits the FR-13B floor and drops. For the MVP's own headline
// demo case the honest output of this pipeline is nothing at all.
//
// This detector may not propose the class a clean exit would satisfy (D-9).
//
// NO NUMERIC LITERAL APPEARS IN THIS FILE (FR-8): every magnitude — the
// correlation window, the affected-session floor — arrives on the rule-set
// PARAMETER, and every count is derived by a set's `size` or an array's
// `length` rather than by arithmetic against a constant written here.
import { measuredCount } from "../counts/measured-count";
import type { EvidenceSignal } from "../evidence/signals";
import type { DetectorName, DetectorProposedClass, ThresholdRuleSet } from "../rules/types";
import { analysedSessions } from "./analysed";
import { orderTimeline } from "./order";
import type {
  DetectorCandidate,
  DetectorCorpus,
  DetectorCoverage,
  DetectorResult,
  SessionTimeline,
  TimelineEvent,
} from "./types";

const DETECTOR: DetectorName = "error_event";

/**
 * PL ruling 13. This detector proposes `broken` because it holds the only
 * signal in this sprint that can prove it: an exception correlated to the
 * action that preceded it. A candidate carrying only UNCORRELATED exceptions
 * still proposes `broken` and is still emitted (PL ruling 17) — the gate then
 * finds no admissible proof, downgrades to `confusing`, finds no struggle, and
 * drops. The signal stays visible in the trace and can never launder into a
 * passing `broken` claim; that is ES-13 working as designed, not a leak.
 */
const CLAIMED_CLASS: DetectorProposedClass = "broken";

/**
 * One surface's accumulating evidence. Mutable, module-private, and never
 * escapes: `candidateOf` copies the signals out.
 */
type SurfaceGroup = {
  readonly signals: DraftSignal[];
  /** Distinct sessions carrying an exception on this surface — the numerator,
   * and what `errorMinAffectedSessions` gates on (PL ruling 17: correlated or
   * not). A set, so two exceptions in one session count that session once. */
  readonly sessionIds: Set<string>;
  /**
   * The subset of `sessionIds` whose exception was actually CORRELATED to a
   * preceding action — i.e. the population the `broken` claim can honestly
   * speak for. Kept apart from `sessionIds` because the two diverge whenever
   * some exceptions correlate and others do not, and conflating them let a
   * one-session proof be reported as a three-session finding (audit C-1).
   */
  readonly correlatedSessionIds: Set<string>;
  readonly normalisationVersions: Set<number | null>;
};

/**
 * Which surface an exception is about (PL ruling 14): the exception's OWN
 * `urlPath`, falling back to the preceding action's when the exception carries
 * none. `null` when neither has one — such an exception is attributed to no
 * surface at all rather than to a guessed one, and it is already counted into
 * `coverage.eventsWithoutUrlPath`, so the omission is reported rather than
 * silent (ES-4, BS-4).
 */
function attributionOf(
  exception: TimelineEvent,
  precedingAction: TimelineEvent | null,
): { readonly surface: string; readonly normalisationVersion: number | null } | null {
  if (exception.urlPath !== null) {
    return {
      surface: exception.urlPath,
      normalisationVersion: exception.urlPathNormalisationVersion,
    };
  }

  if (precedingAction !== null && precedingAction.urlPath !== null) {
    return {
      surface: precedingAction.urlPath,
      normalisationVersion: precedingAction.urlPathNormalisationVersion,
    };
  }

  return null;
}

/**
 * The correlation decision, and the ONLY place this detector reads an instant.
 *
 * CLOCK ANCHOR (FR-6, OQ-E, PL ruling 3): the exception's own `occurredAt`,
 * looking BACKWARD. `precedingAction` is the nearest EARLIER event in the
 * ordered timeline, so the delta is never negative and an action that follows
 * the exception can never be named as its cause.
 *
 * INCLUSIVE at the boundary (D-6): it correlates at
 * `delta <= errorCorrelationWindowMs`, and one millisecond beyond does not.
 *
 * When there is no preceding action, or it lies outside the window, the result
 * is `failure_uncorrelated` — an EXPLICITLY ABSENT correlation, never a
 * fabricated `failure_correlated` (ES-13).
 */
/**
 * A signal minus the cohort count, which is not knowable while walking ONE
 * session: `correlatedSessions` is a property of the whole surface group, so
 * it is attached in `candidateOf` once every session has been seen.
 */
type DraftSignal =
  | Omit<Extract<EvidenceSignal, { kind: "failure_correlated" }>, "correlatedSessions">
  | Extract<EvidenceSignal, { kind: "failure_uncorrelated" }>;

function signalFor(
  exception: TimelineEvent,
  precedingAction: TimelineEvent | null,
  ruleSet: ThresholdRuleSet,
): DraftSignal {
  if (
    precedingAction !== null &&
    exception.occurredAt.getTime() - precedingAction.occurredAt.getTime() <=
      ruleSet.errorCorrelationWindowMs
  ) {
    return {
      kind: "failure_correlated",
      eventName: exception.name,
      occurredAt: exception.occurredAt,
      precedingActionName: precedingAction.name,
      correlationWindowMs: ruleSet.errorCorrelationWindowMs,
    };
  }

  return {
    kind: "failure_uncorrelated",
    eventName: exception.name,
    occurredAt: exception.occurredAt,
  };
}

/**
 * Is this event something that happened TO the user rather than something the
 * user did? (FR-2, FR-14, edge taxonomy D10.)
 *
 * The names arrive on the rule-set PARAMETER (D-14) — this file holds no event
 * name of its own, exactly as it holds no exception name of its own, so a
 * vendor vocabulary change stays a rule-set edit plus a version bump.
 */
function isPassiveEvent(event: TimelineEvent, ruleSet: ThresholdRuleSet): boolean {
  if (ruleSet.passiveEventNames.includes(event.name)) return true;

  // Unknown VENDOR events are passive by default (D10 fail-direction). A
  // denylist alone let any un-named PostHog event become "the action that
  // broke" — a false `broken` verdict in the customer's own words. The
  // customer's own events carry no vendor prefix and are unaffected, so no
  // real correlation is lost.
  if (event.name.startsWith(ruleSet.vendorEventPrefix)) {
    return !ruleSet.userInitiatedVendorEvents.includes(event.name);
  }

  return false;
}

/**
 * Walks ONE session's ordered timeline once, accumulating into `groups`.
 *
 * TWO KINDS OF EVENT MAY NEVER BE NAMED AS A PRECEDING ACTION, and the two
 * rules compose — the second is additive to the first, not a replacement:
 *
 *  1. ANOTHER EXCEPTION (PL ruling 27). Naming one exception as the cause of
 *     the next manufactures a `failure_correlated` out of two failures.
 *  2. A PASSIVE EVENT (`ruleSet.passiveEventNames`). A `$pageview`, a
 *     `$pageleave`, an `$identify`, a `$web_vitals` is something that happened
 *     TO the user. `failure_correlated` is the ONLY signal `brokenProofSignals`
 *     admits, and its whole meaning is "we can prove the thing they were
 *     TRYING to do failed on them". A page load followed by a third-party
 *     script error is nobody trying to do anything, and rendering it as a
 *     passing `broken` claim is the wrong verdict §6 and FR-14 exist to
 *     prevent.
 *
 * THEY DIFFER ON ONE POINT, DELIBERATELY: an exception is SKIPPED (a real
 * action before it survives as the correlation partner — see ruling 27's
 * control test, where an action between two exceptions is still named), while
 * a passive event CLEARS the preceding action outright. Three reasons for the
 * asymmetry:
 *
 *  - a passive event is a BOUNDARY. `$pageview` and `$pageleave` mark a
 *    navigation; after one, an earlier click was on a page the user has left,
 *    and calling it "what they were trying to do here" is the same
 *    over-attribution one step removed. An exception marks no boundary — it is
 *    a symptom that happened DURING what the user was already doing.
 *  - it is the strictly UNDER-DETECT choice (FR-9). Clearing can only ever
 *    produce fewer correlations than skipping; a missed correlation degrades
 *    `broken` -> `confusing` -> drop, and silence is the recoverable failure.
 *  - it costs FR-2's acceptance shape nothing. In
 *    `$pageview -> $autocapture -> $exception` the INTERACTION is what the
 *    detector must name, and it arrives AFTER the passive event, so it is
 *    still the standing preceding action when the exception lands.
 *
 * An exception left with no qualifying preceding action falls through to
 * `failure_uncorrelated` (ES-13) — the absence is stated, never fabricated,
 * and never silently dropped.
 *
 * The one consequence worth naming out loud (ES-4, BS-4): `attributionOf`'s
 * fallback reads the preceding ACTION's `urlPath`, so an exception carrying no
 * path of its own, preceded only by passive events, is now attributed to no
 * surface at all rather than to the page load's. That is the same under-detect
 * direction — the exception is already counted into
 * `coverage.eventsWithoutUrlPath`, so the omission is reported rather than
 * silent.
 */
function collectSession(
  session: SessionTimeline,
  ruleSet: ThresholdRuleSet,
  groups: Map<string, SurfaceGroup>,
): void {
  let precedingAction: TimelineEvent | null = null;

  for (const event of orderTimeline(session.events)) {
    if (event.name !== ruleSet.exceptionEventName) {
      precedingAction = isPassiveEvent(event, ruleSet) ? null : event;
      continue;
    }

    const attribution = attributionOf(event, precedingAction);
    if (attribution === null) {
      continue;
    }

    const group: SurfaceGroup = groups.get(attribution.surface) ?? {
      signals: [],
      sessionIds: new Set<string>(),
      correlatedSessionIds: new Set<string>(),
      normalisationVersions: new Set<number | null>(),
    };
    groups.set(attribution.surface, group);

    const draft = signalFor(event, precedingAction, ruleSet);
    group.signals.push(draft);
    group.sessionIds.add(session.sessionId);
    // The PROVEN cohort, tracked apart from the all-exceptions cohort. These
    // two diverging is exactly the defect: the count reported one population
    // while the verdict rested on the other (audit C-1).
    if (draft.kind === "failure_correlated") {
      group.correlatedSessionIds.add(session.sessionId);
    }
    group.normalisationVersions.add(attribution.normalisationVersion);
  }
}

/**
 * The version to carry onto the candidate (ES-14). Unanimous or nothing: when
 * a surface's contributing events disagree about which normalisation produced
 * their path, no single version describes the claim, and `null` — "redaction
 * status unknown" — is the honest answer. It is never coerced to a number the
 * group cannot support.
 */
function unanimousVersion(versions: ReadonlySet<number | null>): number | null {
  const observed = [...versions];
  const [first] = observed;

  return observed.every((version) => version === first) ? (first ?? null) : null;
}

/** One count builder, so every number this detector emits shares a denominator. */
function countOf(numerator: number, corpus: DetectorCorpus) {
  return measuredCount({
    numerator,
    denominator: corpus.basis.kept,
    unit: "sessions",
    timeframe: corpus.window,
    basis: corpus.basis,
  });
}

function candidateOf(
  surface: string,
  group: SurfaceGroup,
  corpus: DetectorCorpus,
  coverage: DetectorCoverage,
): DetectorCandidate {
  return {
    detector: DETECTOR,
    claimedClass: CLAIMED_CLASS,
    surface,
    surfaceNormalisationVersion: unanimousVersion(group.normalisationVersions),
    signals: group.signals.map((draft) =>
      draft.kind === "failure_correlated"
        ? { ...draft, correlatedSessions: countOf(group.correlatedSessionIds.size, corpus) }
        : draft,
    ),
    // The one magnitude this detector claims: sessions on this surface carrying
    // the exception, over kept sessions (D-7, D-8, FR-10). It travels as a
    // `MeasuredCount` so it cannot reach a customer without its denominator.
    counts: [
      measuredCount({
        numerator: group.sessionIds.size,
        denominator: corpus.basis.kept,
        unit: "sessions",
        timeframe: corpus.window,
        basis: corpus.basis,
      }),
    ],
    timeframe: corpus.window,
    coverage,
  };
}

/**
 * Correlates an exception to the action that preceded it in the same session.
 *
 * CLOCK ANCHOR, declared (FR-6, OQ-E): the exception's OWN `occurredAt`,
 * looking BACKWARD. The preceding action is the nearest earlier event in the
 * ordered timeline, and it correlates when
 * `exception.occurredAt - action.occurredAt <= ruleSet.errorCorrelationWindowMs`
 * — INCLUSIVE (D-6). There is no ambient `now`; nothing here reads a clock.
 *
 * Contract:
 * - the rule set arrives as a PARAMETER; nothing here reads `CURRENT_*` (D-14);
 * - an exception with no preceding action, or one outside the window, emits a
 *   `failure_uncorrelated` signal — an EXPLICITLY ABSENT correlation, never a
 *   fabricated one (ES-13). That signal is deliberately not admissible as
 *   proof of `broken`, which is what stops an unrelated exception laundering
 *   into a `broken` claim;
 * - it does not fire below `ruleSet.errorMinAffectedSessions` — fail direction
 *   under-detect (FR-9);
 * - the denominator is `corpus.basis.kept` (D-7, FR-7);
 * - `corpus.coverage.truncated` propagates onto EVERY candidate (D-3).
 *
 * PURE: no I/O, no ambient clock, no randomness (FR-5).
 */
export function detectErrorEvent(
  corpus: DetectorCorpus,
  ruleSet: ThresholdRuleSet,
): DetectorResult {
  // FR-7 and D-3 in ONE call, shared with `funnel-dropoff.ts` (PL rulings 7,
  // 16 and 24): FR-7 is applied HERE rather than in the read, so a set-aside
  // session reaches no numerator and inflates no denominator; `truncated`
  // propagates; and `eventsWithoutUrlPath` is recomputed over exactly the kept
  // sessions returned beside it. One call, so the coverage can only ever
  // describe the population actually analysed.
  const { kept, coverage } = analysedSessions(corpus);

  const groups = new Map<string, SurfaceGroup>();
  for (const session of kept) {
    collectSession(session, ruleSet, groups);
  }

  const candidates = [...groups.entries()]
    // INCLUSIVE (D-6): it fires AT `errorMinAffectedSessions`, not one above.
    .filter(([, group]) => group.sessionIds.size >= ruleSet.errorMinAffectedSessions)
    .map(([surface, group]) => candidateOf(surface, group, corpus, coverage));

  return {
    detector: DETECTOR,
    // ES-1 vs ES-8: an empty `candidates` array is a real answer, and this is
    // what stops it being read as "the detector never ran".
    connectionState: corpus.connectionState,
    coverage,
    candidates,
  };
}
