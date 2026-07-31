// ADD §7 "Unit — `error_event`" — the eight named contract tests (O-004 FR-2,
// FR-6, FR-9, D-6, D-9, D-18, ES-10, ES-13).
//
// Two of these carry most of the weight:
//
//  - "should match the exception name from the rule set, never an inlined
//    literal" (D-18, D9). It is written so it FAILS if anyone inlines
//    `"$exception"`: the rule set handed in names a DIFFERENT event, and the
//    detector must follow the rule set. The literal `"$exception"` appears in
//    the same corpus as a decoy and must be ignored.
//
//  - "should emit an explicitly absent correlation for an exception with no
//    preceding action, never a fabricated one" (ES-13). This is what stops an
//    `$exception` unrelated to the user's action laundering into a `broken`
//    claim. An uncorrelated exception is recorded HONESTLY as
//    `failure_uncorrelated`; `failure_correlated` must never be invented for
//    it. (That `failure_uncorrelated` is then not admissible proof of `broken`
//    is the gate's half of the contract, asserted in the predicates suite.)
//
// CLOCK (ADD §6.5, PL ruling 3): there is no `now` parameter anywhere in this
// package. The suite's instants are FIXTURE CONSTANTS passed explicitly into
// every helper — no helper here reads `Date.now()`, so no test in this file
// can be time-of-day flaky.
//
// BOUNDARIES (D-6): inclusive, everywhere. A correlation holds at
// `delta <= errorCorrelationWindowMs`; one millisecond beyond does not.
//
// LANE PREFIX: every fixture id, session id, event name, and path in this file
// is prefixed `t1err` — a NEW prefix, shared with no other suite (ADD §6.5).
// The passive-event denylist suite added later in this file runs in its OWN
// lane, `t1psv`, with its own surface, its own session ids, and its own
// corpus builder, so neither set of fixtures can be read as the other's.
import type { ConnectionState } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import type { CountBasis } from "../../src/counts/measured-count";
import { isMeasuredCount } from "../../src/counts/measured-count";
import { detectErrorEvent } from "../../src/detect/error-event";
import { evaluate } from "../../src/evidence/gate";
import type {
  AnalysisWindow,
  DetectorCandidate,
  DetectorCorpus,
  DetectorResult,
  SessionTimeline,
  TimelineEvent,
} from "../../src/detect/types";
import type { EvidenceSignal } from "../../src/evidence/signals";
import { THRESHOLD_RULE_SETS } from "../../src/rules/thresholds";
import type { ThresholdRuleSet } from "../../src/rules/types";

// ---------------------------------------------------------------------------
// Fixture time — required parameters, never a clock read
// ---------------------------------------------------------------------------

/** The suite's analysis window. A fixed instant pair, passed in explicitly. */
const FIXTURE_WINDOW: AnalysisWindow = {
  start: new Date("2026-05-01T00:00:00.000Z"),
  end: new Date("2026-05-08T00:00:00.000Z"),
};

/** The instant every fixture exception occurs at, well inside the window. */
const FIXTURE_EXCEPTION_AT = new Date("2026-05-04T09:00:00.000Z");

/** `base` shifted BACKWARD by `offsetMs`. Both are parameters; nothing here
 * consults a clock. */
function before(base: Date, offsetMs: number): Date {
  return new Date(base.getTime() - offsetMs);
}

/** `base` shifted FORWARD by `offsetMs`. */
function after(base: Date, offsetMs: number): Date {
  return new Date(base.getTime() + offsetMs);
}

// ---------------------------------------------------------------------------
// Fixture vocabulary — all `t1err`-prefixed, colliding with no other suite
// ---------------------------------------------------------------------------

const T1ERR_SURFACE = "/t1err/checkout";
const T1ERR_ACTION = "t1err_submit_clicked";
const T1ERR_LATER_ACTION = "t1err_retry_clicked";
/** The exception name used when the rule set is v1's own. */
const T1ERR_VENDOR_EXCEPTION = "$exception";
/** A DIFFERENT exception name, used to prove the detector reads the rule set. */
const T1ERR_RENAMED_EXCEPTION = "t1err_thrown_by_another_vendor";

/** The v1 rule set fetched BY VERSION, never "whatever is current" (D-14). */
function ruleSetV1(): ThresholdRuleSet {
  const rules = THRESHOLD_RULE_SETS.get(1);
  if (!rules) throw new Error("threshold rule set version 1 must remain resolvable forever");
  return rules;
}

/** The same rule set with a different exception name — the whole point of
 * D-18: a vendor name change is a rule-set edit, not a detector edit. */
function withExceptionName(base: ThresholdRuleSet, exceptionEventName: string): ThresholdRuleSet {
  return { ...base, exceptionEventName };
}

// ---------------------------------------------------------------------------
// Corpus builders
// ---------------------------------------------------------------------------

const T1ERR_CONNECTION_STATE: ConnectionState = {
  status: "connected_receiving",
  connection: {
    id: "t1err-connection",
    organizationId: "t1err-org",
    projectId: "t1err-project",
    sourceKind: "posthog",
    host: "https://t1err.example.invalid",
    sourceProjectId: "t1err-source-project",
    isActive: true,
    health: "healthy",
    healthReasonCode: null,
    healthReasonMessage: null,
    healthCheckedAt: FIXTURE_WINDOW.end,
    watermarkAt: FIXTURE_WINDOW.end,
    backfillBefore: null,
    pollIntervalSeconds: 60,
    connectedAt: FIXTURE_WINDOW.start,
    inferredInternalDomain: null,
    internalDomainProvenance: null,
  },
};

function timelineEvent(id: string, name: string, occurredAt: Date): TimelineEvent {
  return {
    sourceEventId: id,
    name,
    occurredAt,
    urlPath: T1ERR_SURFACE,
    urlPathNormalisationVersion: 1,
  };
}

function sessionOf(index: number, events: readonly TimelineEvent[]): SessionTimeline {
  return {
    sessionId: `t1err-session-${index}`,
    startedAt: FIXTURE_WINDOW.start,
    // Every fixture session is KEPT, so `basis.kept` is the whole corpus and
    // FR-7's filtering is not what any assertion in this file turns on.
    exclusionReason: "none",
    entryUrlPath: T1ERR_SURFACE,
    events,
  };
}

/** `n` sessions, each an action followed `gapMs` later by an exception. */
function sessionsWithPrecedingAction(input: {
  readonly count: number;
  readonly actionName: string;
  readonly exceptionName: string;
  readonly exceptionAt: Date;
  readonly gapMs: number;
}): readonly SessionTimeline[] {
  return Array.from({ length: input.count }, (_unused, i) =>
    sessionOf(i, [
      timelineEvent(`t1err-e${i}-action`, input.actionName, before(input.exceptionAt, input.gapMs)),
      timelineEvent(`t1err-e${i}-exception`, input.exceptionName, input.exceptionAt),
    ]),
  );
}

/** `n` sessions, each carrying a lone exception and nothing before it. */
function sessionsWithLoneException(input: {
  readonly count: number;
  readonly exceptionName: string;
  readonly exceptionAt: Date;
}): readonly SessionTimeline[] {
  return Array.from({ length: input.count }, (_unused, i) =>
    sessionOf(i, [timelineEvent(`t1err-e${i}-exception`, input.exceptionName, input.exceptionAt)]),
  );
}

function corpusOf(sessions: readonly SessionTimeline[]): DetectorCorpus {
  const basis: CountBasis = {
    totalInWindow: sessions.length,
    kept: sessions.length,
    setAside: [],
  };
  return {
    projectId: "t1err-project",
    window: FIXTURE_WINDOW,
    connectionState: T1ERR_CONNECTION_STATE,
    sessions,
    basis,
    coverage: { truncated: false, eventsWithoutUrlPath: 0 },
  };
}

// ---------------------------------------------------------------------------
// Signal readers
// ---------------------------------------------------------------------------

type CorrelatedSignal = Extract<EvidenceSignal, { kind: "failure_correlated" }>;
type UncorrelatedSignal = Extract<EvidenceSignal, { kind: "failure_uncorrelated" }>;

function signalsOf(result: DetectorResult): readonly EvidenceSignal[] {
  return result.candidates.flatMap((candidate) => candidate.signals);
}

function correlatedSignalsOf(result: DetectorResult): readonly CorrelatedSignal[] {
  return signalsOf(result).filter((s): s is CorrelatedSignal => s.kind === "failure_correlated");
}

function uncorrelatedSignalsOf(result: DetectorResult): readonly UncorrelatedSignal[] {
  return signalsOf(result).filter(
    (s): s is UncorrelatedSignal => s.kind === "failure_uncorrelated",
  );
}

// ---------------------------------------------------------------------------

describe("detectErrorEvent", () => {
  // D-18 / D9. The load-bearing test of the whole file: the name is DATA, not
  // code. Written to fail if `"$exception"` is inlined in the detector body —
  // the rule set names a different event, and `"$exception"` is present in the
  // same corpus as a decoy that must be ignored.
  test("should match the exception name from the rule set, never an inlined literal", () => {
    const ruleSet = withExceptionName(ruleSetV1(), T1ERR_RENAMED_EXCEPTION);

    const renamed = detectErrorEvent(
      corpusOf(
        sessionsWithPrecedingAction({
          count: ruleSet.errorMinAffectedSessions,
          actionName: T1ERR_ACTION,
          exceptionName: T1ERR_RENAMED_EXCEPTION,
          exceptionAt: FIXTURE_EXCEPTION_AT,
          gapMs: 1_000,
        }),
      ),
      ruleSet,
    );

    expect(correlatedSignalsOf(renamed).map((s) => s.eventName)).toContain(T1ERR_RENAMED_EXCEPTION);

    // The same corpus shape carrying the VENDOR literal, judged under a rule
    // set that does not name it. A detector reading the rule set sees no
    // exception here at all; a detector with the literal inlined sees three.
    const decoy = detectErrorEvent(
      corpusOf(
        sessionsWithPrecedingAction({
          count: ruleSet.errorMinAffectedSessions,
          actionName: T1ERR_ACTION,
          exceptionName: T1ERR_VENDOR_EXCEPTION,
          exceptionAt: FIXTURE_EXCEPTION_AT,
          gapMs: 1_000,
        }),
      ),
      ruleSet,
    );

    expect(signalsOf(decoy)).toEqual([]);
  });

  // FR-2. The ordinary case: an exception tied to the action that preceded it.
  test("should correlate an exception to the preceding action within errorCorrelationWindowMs", () => {
    const ruleSet = ruleSetV1();
    const gapMs = Math.floor(ruleSet.errorCorrelationWindowMs / 2);

    const result = detectErrorEvent(
      corpusOf(
        sessionsWithPrecedingAction({
          count: ruleSet.errorMinAffectedSessions,
          actionName: T1ERR_ACTION,
          exceptionName: ruleSet.exceptionEventName,
          exceptionAt: FIXTURE_EXCEPTION_AT,
          gapMs,
        }),
      ),
      ruleSet,
    );

    const correlated = correlatedSignalsOf(result);
    expect(correlated.length).toBe(ruleSet.errorMinAffectedSessions);
    expect(correlated.every((s) => s.precedingActionName === T1ERR_ACTION)).toBe(true);
    expect(
      correlated.every((s) => s.correlationWindowMs === ruleSet.errorCorrelationWindowMs),
    ).toBe(true);
  });

  // ES-10 / D-6. Inclusive: it fires AT the threshold, not one below it.
  test("should correlate at exactly errorCorrelationWindowMs (inclusive boundary)", () => {
    const ruleSet = ruleSetV1();

    const result = detectErrorEvent(
      corpusOf(
        sessionsWithPrecedingAction({
          count: ruleSet.errorMinAffectedSessions,
          actionName: T1ERR_ACTION,
          exceptionName: ruleSet.exceptionEventName,
          exceptionAt: FIXTURE_EXCEPTION_AT,
          gapMs: ruleSet.errorCorrelationWindowMs,
        }),
      ),
      ruleSet,
    );

    const correlated = correlatedSignalsOf(result);
    expect(correlated.length).toBe(ruleSet.errorMinAffectedSessions);
    expect(correlated.every((s) => s.precedingActionName === T1ERR_ACTION)).toBe(true);
  });

  // FR-2, FR-9. Fail direction: UNDER-DETECT. One millisecond beyond the
  // window is a coincidence, and a coincidence dressed as a cause is the
  // over-permissive predicate the PRD names as a High risk.
  test("should not correlate an exception outside the window", () => {
    const ruleSet = ruleSetV1();

    const result = detectErrorEvent(
      corpusOf(
        sessionsWithPrecedingAction({
          count: ruleSet.errorMinAffectedSessions,
          actionName: T1ERR_ACTION,
          exceptionName: ruleSet.exceptionEventName,
          exceptionAt: FIXTURE_EXCEPTION_AT,
          gapMs: ruleSet.errorCorrelationWindowMs + 1,
        }),
      ),
      ruleSet,
    );

    expect(correlatedSignalsOf(result)).toEqual([]);
  });

  // ES-13. The other load-bearing test. An exception with nothing before it
  // must be recorded as an EXPLICITLY ABSENT correlation, never as a
  // fabricated one — this is what stops an unrelated exception laundering into
  // a `broken` claim.
  test("should emit an explicitly absent correlation for an exception with no preceding action, never a fabricated one", () => {
    const ruleSet = ruleSetV1();

    const result = detectErrorEvent(
      corpusOf(
        sessionsWithLoneException({
          count: ruleSet.errorMinAffectedSessions,
          exceptionName: ruleSet.exceptionEventName,
          exceptionAt: FIXTURE_EXCEPTION_AT,
        }),
      ),
      ruleSet,
    );

    // Nothing may be invented: there is no preceding action to name.
    expect(correlatedSignalsOf(result)).toEqual([]);

    // And the exception is not silently dropped either — absence is stated.
    const uncorrelated = uncorrelatedSignalsOf(result);
    expect(uncorrelated.length).toBe(ruleSet.errorMinAffectedSessions);
    expect(uncorrelated.every((s) => s.eventName === ruleSet.exceptionEventName)).toBe(true);
    expect(
      uncorrelated.every((s) => s.occurredAt.getTime() === FIXTURE_EXCEPTION_AT.getTime()),
    ).toBe(true);
  });

  // FR-9. Fail direction: UNDER-DETECT. One session with an exception is an
  // anecdote; the rule set's magnitude is what makes it not a finding.
  test("should not fire below errorMinAffectedSessions", () => {
    const ruleSet = ruleSetV1();

    const result = detectErrorEvent(
      corpusOf(
        sessionsWithPrecedingAction({
          count: ruleSet.errorMinAffectedSessions - 1,
          actionName: T1ERR_ACTION,
          exceptionName: ruleSet.exceptionEventName,
          exceptionAt: FIXTURE_EXCEPTION_AT,
          gapMs: 1_000,
        }),
      ),
      ruleSet,
    );

    expect(result.candidates).toEqual([]);
  });

  // FR-6 / OQ-E, and PL ruling 3: there is no `now`. The anchor is the
  // exception's OWN `occurredAt`, and the search runs BACKWARD. A session here
  // carries an action on each side of the exception, both inside the window —
  // only a backward-looking detector names the earlier one.
  test("should declare its clock anchor as the exception's own occurred_at, looking backward", () => {
    const ruleSet = ruleSetV1();
    const backwardGapMs = Math.floor(ruleSet.errorCorrelationWindowMs / 3);
    const forwardGapMs = Math.floor(ruleSet.errorCorrelationWindowMs / 6);

    const sessions = Array.from({ length: ruleSet.errorMinAffectedSessions }, (_unused, i) =>
      sessionOf(i, [
        timelineEvent(
          `t1err-e${i}-earlier`,
          T1ERR_ACTION,
          before(FIXTURE_EXCEPTION_AT, backwardGapMs),
        ),
        timelineEvent(`t1err-e${i}-exception`, ruleSet.exceptionEventName, FIXTURE_EXCEPTION_AT),
        timelineEvent(
          `t1err-e${i}-later`,
          T1ERR_LATER_ACTION,
          after(FIXTURE_EXCEPTION_AT, forwardGapMs),
        ),
      ]),
    );

    const correlated = correlatedSignalsOf(detectErrorEvent(corpusOf(sessions), ruleSet));

    expect(correlated.length).toBe(ruleSet.errorMinAffectedSessions);
    // Backward, never forward.
    expect(correlated.every((s) => s.precedingActionName === T1ERR_ACTION)).toBe(true);
    expect(correlated.some((s) => s.precedingActionName === T1ERR_LATER_ACTION)).toBe(false);
    // Anchored on the exception's own instant, not the action's.
    expect(correlated.every((s) => s.occurredAt.getTime() === FIXTURE_EXCEPTION_AT.getTime())).toBe(
      true,
    );
  });

  // D-9. The front door. `changed_mind`'s proof is satisfied by the ABSENCE of
  // everything, so a deterministic detector proposing it renders "we detected
  // nothing" as "we detected a user decision". No T1 detector may do it — on a
  // correlated corpus, an uncorrelated one, or a clean one.
  test("should never propose changed_mind", () => {
    const ruleSet = ruleSetV1();

    const corpus = corpusOf([
      ...sessionsWithPrecedingAction({
        count: ruleSet.errorMinAffectedSessions,
        actionName: T1ERR_ACTION,
        exceptionName: ruleSet.exceptionEventName,
        exceptionAt: FIXTURE_EXCEPTION_AT,
        gapMs: 1_000,
      }),
      ...sessionsWithLoneException({
        count: ruleSet.errorMinAffectedSessions,
        exceptionName: ruleSet.exceptionEventName,
        exceptionAt: FIXTURE_EXCEPTION_AT,
      }),
      // A clean session: an action, no exception, nothing to say about it.
      sessionOf(99, [
        timelineEvent("t1err-e99-action", T1ERR_ACTION, before(FIXTURE_EXCEPTION_AT, 5_000)),
      ]),
    ]);

    const classes = detectErrorEvent(corpus, ruleSet).candidates.map(
      (candidate): string => candidate.claimedClass,
    );

    // Non-vacuity: this corpus DOES produce candidates, so the assertion below
    // is about what they claim rather than about there being none.
    expect(classes.length).toBeGreaterThan(0);
    expect(classes).not.toContain("changed_mind");
  });
});

// ===========================================================================
// PL RULING 27 — a "preceding action" is never another exception (Wave 7, 6.7)
//
// THE GAP THIS CLOSES. `detectErrorEvent` skips other exceptions when choosing
// an exception's correlation partner, and until now nothing asserted it.
//
// WHY IT MATTERS. Naming one exception as the cause of the next manufactures a
// `failure_correlated` out of TWO FAILURES — and `failure_correlated` is the
// ONLY admissible proof of `broken` (BROKEN_PROOF_SIGNALS_V1). A fabricated one
// walks straight through the evidence gate as a passing `broken` claim, which
// is the precise outcome the gate exists to prevent and the over-permissive
// predicate the PRD names as a High risk. Skipping exceptions can only ever
// produce FEWER correlations, so it is strictly the under-detect direction
// (FR-9).
//
// Every fixture below reuses this file's `t1err` lane, its frozen instants, and
// its explicit-parameter helpers. No `Date.now()` is introduced (ADD §6.5).
// ===========================================================================

/** Deliberately WELL INSIDE `errorCorrelationWindowMs`, so a detector that took
 * the nearest earlier event verbatim would name the first exception as the
 * second's cause. The window is what must NOT be doing the work here. */
const T1ERR_CONSECUTIVE_GAP_MS = 1_000;

/** `n` sessions, each carrying TWO exceptions back to back with no user action
 * between them — nor anywhere else in the session. */
function sessionsWithConsecutiveExceptions(input: {
  readonly count: number;
  readonly exceptionName: string;
  readonly firstExceptionAt: Date;
  readonly gapMs: number;
}): readonly SessionTimeline[] {
  return Array.from({ length: input.count }, (_unused, i) =>
    sessionOf(i, [
      timelineEvent(`t1err-e${i}-exception-first`, input.exceptionName, input.firstExceptionAt),
      timelineEvent(
        `t1err-e${i}-exception-second`,
        input.exceptionName,
        after(input.firstExceptionAt, input.gapMs),
      ),
    ]),
  );
}

/** The CONTROL: the same two exceptions, with a genuine user action sitting
 * between them. Proves the skip is narrow — it removes exceptions from
 * candidacy and nothing else. */
function sessionsWithActionBetweenExceptions(input: {
  readonly count: number;
  readonly actionName: string;
  readonly exceptionName: string;
  readonly firstExceptionAt: Date;
  readonly gapMs: number;
}): readonly SessionTimeline[] {
  return Array.from({ length: input.count }, (_unused, i) =>
    sessionOf(i, [
      timelineEvent(`t1err-e${i}-exception-first`, input.exceptionName, input.firstExceptionAt),
      timelineEvent(
        `t1err-e${i}-action`,
        input.actionName,
        after(input.firstExceptionAt, input.gapMs),
      ),
      timelineEvent(
        `t1err-e${i}-exception-second`,
        input.exceptionName,
        after(input.firstExceptionAt, input.gapMs * 2),
      ),
    ]),
  );
}

function consecutiveExceptionsResult(ruleSet: ThresholdRuleSet): DetectorResult {
  return detectErrorEvent(
    corpusOf(
      sessionsWithConsecutiveExceptions({
        count: ruleSet.errorMinAffectedSessions,
        exceptionName: ruleSet.exceptionEventName,
        firstExceptionAt: FIXTURE_EXCEPTION_AT,
        gapMs: T1ERR_CONSECUTIVE_GAP_MS,
      }),
    ),
    ruleSet,
  );
}

describe("detectErrorEvent — a preceding action is never another exception (PL ruling 27)", () => {
  test("should not name one exception as the preceding action of the next", () => {
    const ruleSet = ruleSetV1();

    // Fixture self-check: the two exceptions sit well inside one another's
    // correlation window, so ONLY the exception skip can keep them apart. If
    // the window were doing the work, this test would prove nothing.
    expect(T1ERR_CONSECUTIVE_GAP_MS).toBeLessThan(ruleSet.errorCorrelationWindowMs);

    const result = consecutiveExceptionsResult(ruleSet);

    // NON-VACUITY: the corpus clears `errorMinAffectedSessions` and emits a
    // candidate, so an empty correlated list is the skip working rather than
    // the detector having found nothing at all.
    expect(result.candidates).toHaveLength(1);

    // A `failure_correlated` built from two failures is a FABRICATED `broken`
    // claim — the one signal kind the gate admits as proof of `broken`.
    expect(correlatedSignalsOf(result)).toEqual([]);
  });

  test("should record the second of two consecutive exceptions as failure_uncorrelated", () => {
    const ruleSet = ruleSetV1();
    const secondExceptionAt = after(FIXTURE_EXCEPTION_AT, T1ERR_CONSECUTIVE_GAP_MS);

    const uncorrelated = uncorrelatedSignalsOf(consecutiveExceptionsResult(ruleSet));

    // BOTH exceptions in every session: the first has nothing before it, and
    // the second has only the first — which does not count. Neither is
    // silently dropped; ES-13's absence is STATED, not implied by silence.
    expect(uncorrelated.length).toBe(ruleSet.errorMinAffectedSessions * 2);

    const forSecondException = uncorrelated.filter(
      (signal) => signal.occurredAt.getTime() === secondExceptionAt.getTime(),
    );
    expect(forSecondException.length).toBe(ruleSet.errorMinAffectedSessions);
    expect(
      forSecondException.every((signal) => signal.eventName === ruleSet.exceptionEventName),
    ).toBe(true);
  });

  test("should correlate the second exception to a genuine user action sitting between them", () => {
    const ruleSet = ruleSetV1();
    const secondExceptionAt = after(FIXTURE_EXCEPTION_AT, T1ERR_CONSECUTIVE_GAP_MS * 2);

    const result = detectErrorEvent(
      corpusOf(
        sessionsWithActionBetweenExceptions({
          count: ruleSet.errorMinAffectedSessions,
          actionName: T1ERR_ACTION,
          exceptionName: ruleSet.exceptionEventName,
          firstExceptionAt: FIXTURE_EXCEPTION_AT,
          gapMs: T1ERR_CONSECUTIVE_GAP_MS,
        }),
      ),
      ruleSet,
    );

    const correlated = correlatedSignalsOf(result);

    // The control half. Ruling 27 costs no GENUINE correlation: a real action
    // between two exceptions is still named, and it is named for the SECOND
    // exception — the one the skip could have mis-attributed.
    expect(correlated.length).toBe(ruleSet.errorMinAffectedSessions);
    expect(correlated.every((signal) => signal.precedingActionName === T1ERR_ACTION)).toBe(true);
    expect(
      correlated.every((signal) => signal.precedingActionName !== ruleSet.exceptionEventName),
    ).toBe(true);
    expect(
      correlated.every((signal) => signal.occurredAt.getTime() === secondExceptionAt.getTime()),
    ).toBe(true);

    // The FIRST exception still has nothing before it and is still recorded as
    // an explicitly absent correlation rather than dropped (ES-13).
    const uncorrelated = uncorrelatedSignalsOf(result);
    expect(uncorrelated.length).toBe(ruleSet.errorMinAffectedSessions);
    expect(
      uncorrelated.every(
        (signal) => signal.occurredAt.getTime() === FIXTURE_EXCEPTION_AT.getTime(),
      ),
    ).toBe(true);
  });
});

// ===========================================================================
// THE PASSIVE-EVENT DENYLIST — a page load is not something a user was TRYING
// to do (FR-2, FR-14, product decisions §6, edge taxonomy D10)
//
// THE DEFECT THIS CLOSES, verbatim. `collectSession` used to promote EVERY
// non-exception event to "the preceding action". So a `$pageview` at page
// load, followed within `errorCorrelationWindowMs` by a third-party script
// error, an ad-blocker-induced fetch failure, or an SDK-captured console
// error, emitted `failure_correlated { precedingActionName: "$pageview" }`.
//
// WHY THAT WAS THE WORST POSSIBLE OVER-DETECT. `failure_correlated` is the
// ONLY member of `BROKEN_PROOF_SIGNALS_V1`. Three such sessions on one surface
// therefore PASSED the evidence gate, and the customer read `broken_satisfied`
// — "We could prove the thing they were trying to do failed on them" — when
// nobody was trying to do anything. A wrong verdict rendered in the customer's
// own words is precisely what §6's "no verdict beats a wrong verdict" and
// FR-14 exist to prevent, and a predicate firing on a SUPERSET of its real
// target is the D10 conflation this whole sprint exists to prevent.
//
// EVERY FIXTURE ABOVE THIS LINE USED A NAMED CLICK, which is why none of them
// caught it.
//
// FAIL DIRECTION: UNDER-DETECT (FR-9). A passive event does not merely fail to
// become the action — it CLEARS a real one, because `$pageview`/`$pageleave`
// mark a navigation and an earlier click was on a page the user has left.
// That can only ever produce fewer correlations, and a missed correlation
// degrades `broken` -> `confusing` -> drop, which ruling 17 already
// established as the recoverable direction.
//
// LANE PREFIX `t1psv`, shared with no other suite (ADD §6.5). Fixture time is
// a REQUIRED PARAMETER on every helper below; nothing here reads a clock.
// ===========================================================================

const T1PSV_SURFACE = "/t1psv/pricing";
/** A real interaction — the control lane's action. */
const T1PSV_ACTION = "t1psv_plan_selected";
/** The gap between the passive event and the exception. Deliberately WELL
 * INSIDE `errorCorrelationWindowMs`, so only the denylist can keep them apart:
 * if the window were doing the work, the test would prove nothing. */
const T1PSV_GAP_MS = 5_000;

function t1psvEvent(id: string, name: string, occurredAt: Date): TimelineEvent {
  return {
    sourceEventId: id,
    name,
    occurredAt,
    urlPath: T1PSV_SURFACE,
    urlPathNormalisationVersion: 1,
  };
}

function t1psvSession(index: number, events: readonly TimelineEvent[]): SessionTimeline {
  return {
    sessionId: `t1psv-session-${index}`,
    startedAt: FIXTURE_WINDOW.start,
    exclusionReason: "none",
    entryUrlPath: T1PSV_SURFACE,
    events,
  };
}

/** `n` sessions, each a single passive event followed `gapMs` later by an
 * exception — the production shape: a page load, then a third-party error. */
function t1psvPassiveThenException(input: {
  readonly count: number;
  readonly passiveName: string;
  readonly exceptionName: string;
  readonly exceptionAt: Date;
  readonly gapMs: number;
}): readonly SessionTimeline[] {
  return Array.from({ length: input.count }, (_unused, i) =>
    t1psvSession(i, [
      t1psvEvent(`t1psv-e${i}-passive`, input.passiveName, before(input.exceptionAt, input.gapMs)),
      t1psvEvent(`t1psv-e${i}-exception`, input.exceptionName, input.exceptionAt),
    ]),
  );
}

/** The FR-2 acceptance shape: `$pageview -> interaction -> $exception`. The
 * INTERACTION is what must be named, and it arrives after the passive event —
 * so clearing on the passive event costs this shape nothing. */
function t1psvPassiveThenActionThenException(input: {
  readonly count: number;
  readonly passiveName: string;
  readonly actionName: string;
  readonly exceptionName: string;
  readonly exceptionAt: Date;
  readonly gapMs: number;
}): readonly SessionTimeline[] {
  return Array.from({ length: input.count }, (_unused, i) =>
    t1psvSession(i, [
      t1psvEvent(
        `t1psv-e${i}-passive`,
        input.passiveName,
        before(input.exceptionAt, input.gapMs * 2),
      ),
      t1psvEvent(`t1psv-e${i}-action`, input.actionName, before(input.exceptionAt, input.gapMs)),
      t1psvEvent(`t1psv-e${i}-exception`, input.exceptionName, input.exceptionAt),
    ]),
  );
}

function t1psvCorpus(sessions: readonly SessionTimeline[]): DetectorCorpus {
  const basis: CountBasis = {
    totalInWindow: sessions.length,
    kept: sessions.length,
    setAside: [],
  };
  return {
    projectId: "t1psv-project",
    window: FIXTURE_WINDOW,
    connectionState: T1ERR_CONNECTION_STATE,
    sessions,
    basis,
    coverage: { truncated: false, eventsWithoutUrlPath: 0 },
  };
}

describe("detectErrorEvent — a passive event is never the preceding action (FR-2, FR-14, D10)", () => {
  // THE FAIL-DIRECTION TEST for `passiveEventNames` (FR-9, FR-22). Its NAME is
  // what `coverage.test.ts`'s `NAME_LIST_FAIL_DIRECTION_TESTS` row points at —
  // do not rename it without repointing that row.
  test("should not name a passive page event as the action an exception broke", () => {
    const ruleSet = ruleSetV1();

    // Fixture self-checks. Both matter: the denylist must really carry the
    // name under test, and the gap must sit inside the correlation window, or
    // this test would pass for the wrong reason.
    const [passiveName] = ruleSet.passiveEventNames;
    expect(passiveName).toBeDefined();
    expect(T1PSV_GAP_MS).toBeLessThan(ruleSet.errorCorrelationWindowMs);

    const result = detectErrorEvent(
      t1psvCorpus(
        t1psvPassiveThenException({
          count: ruleSet.errorMinAffectedSessions,
          passiveName: passiveName ?? "",
          exceptionName: ruleSet.exceptionEventName,
          exceptionAt: FIXTURE_EXCEPTION_AT,
          gapMs: T1PSV_GAP_MS,
        }),
      ),
      ruleSet,
    );

    // NON-VACUITY: the corpus clears `errorMinAffectedSessions` and DOES open
    // a candidate, so an empty correlated list below is the denylist working
    // rather than the detector having found nothing at all.
    expect(result.candidates).toHaveLength(1);

    // (1) NOTHING IS FABRICATED. A `failure_correlated` here would be the only
    // signal the gate admits as proof of `broken`, built out of a page load.
    expect(correlatedSignalsOf(result)).toEqual([]);

    // (2) AND THE EXCEPTION IS NOT SILENTLY DROPPED EITHER (ES-13). Absence of
    // a correlation is STATED, per exception, per session.
    const uncorrelated = uncorrelatedSignalsOf(result);
    expect(uncorrelated.length).toBe(ruleSet.errorMinAffectedSessions);
    expect(uncorrelated.every((signal) => signal.eventName === ruleSet.exceptionEventName)).toBe(
      true,
    );
  });

  // The whole point, driven through the gate's real entry point: the claim the
  // detector produces from a passive-only corpus must reach the customer as
  // SILENCE, not as `broken_satisfied` in their own words (D11 — a producer
  // test plus a consumer test does not prove the wire between them).
  test("should drop the claim a passive-only corpus produces rather than pass it as broken", () => {
    const ruleSet = ruleSetV1();
    const [passiveName] = ruleSet.passiveEventNames;

    const result = detectErrorEvent(
      t1psvCorpus(
        t1psvPassiveThenException({
          count: ruleSet.errorMinAffectedSessions,
          passiveName: passiveName ?? "",
          exceptionName: ruleSet.exceptionEventName,
          exceptionAt: FIXTURE_EXCEPTION_AT,
          gapMs: T1PSV_GAP_MS,
        }),
      ),
      ruleSet,
    );

    const outcome = evaluate(result.candidates[0], ruleSet);

    expect(outcome.kind).toBe("drop");
    // Both rungs evaluated and both unsatisfied: no admissible proof of
    // `broken`, no struggle to fall back on, then the FR-13B floor.
    expect(outcome.trace.map((entry) => entry.class)).toEqual(["broken", "confusing"]);
    expect(outcome.trace.every((entry) => entry.satisfied === false)).toBe(true);
  });

  // EVERY member of the list, not just the first — a denylist with a name in
  // it that nothing exercises is a rule nobody has proven.
  test("should refuse to correlate against every name in passiveEventNames", () => {
    const ruleSet = ruleSetV1();

    // Non-vacuity: the list is not empty, so the loop below is a real sweep.
    expect(ruleSet.passiveEventNames.length).toBeGreaterThan(0);

    for (const passiveName of ruleSet.passiveEventNames) {
      const result = detectErrorEvent(
        t1psvCorpus(
          t1psvPassiveThenException({
            count: ruleSet.errorMinAffectedSessions,
            passiveName,
            exceptionName: ruleSet.exceptionEventName,
            exceptionAt: FIXTURE_EXCEPTION_AT,
            gapMs: T1PSV_GAP_MS,
          }),
        ),
        ruleSet,
      );

      expect(result.candidates).toHaveLength(1);
      expect(correlatedSignalsOf(result).map((signal) => signal.precedingActionName)).toEqual([]);
    }
  });

  // THE CONTROL, and the reason this fix under-detects rather than simply
  // detecting nothing. Two halves:
  //
  //  (a) the FR-2 acceptance shape `$pageview -> interaction -> $exception`
  //      still correlates, to the INTERACTION, and still passes the gate; and
  //  (b) the name is DATA — a rule set that does not list the event treats it
  //      as an ordinary action, so this is a rule-set edit and not a detector
  //      edit (D-14, D-18).
  test("should still correlate the interaction that follows a passive event, and still pass", () => {
    const ruleSet = ruleSetV1();
    const [passiveName] = ruleSet.passiveEventNames;

    const result = detectErrorEvent(
      t1psvCorpus(
        t1psvPassiveThenActionThenException({
          count: ruleSet.errorMinAffectedSessions,
          passiveName: passiveName ?? "",
          actionName: T1PSV_ACTION,
          exceptionName: ruleSet.exceptionEventName,
          exceptionAt: FIXTURE_EXCEPTION_AT,
          gapMs: T1PSV_GAP_MS,
        }),
      ),
      ruleSet,
    );

    const correlated = correlatedSignalsOf(result);
    expect(correlated.length).toBe(ruleSet.errorMinAffectedSessions);
    expect(correlated.every((signal) => signal.precedingActionName === T1PSV_ACTION)).toBe(true);
    expect(correlated.some((signal) => signal.precedingActionName === passiveName)).toBe(false);

    // ...and the claim it produces still reaches the customer as `broken`.
    // Without this half, "no correlations" would be an acceptable answer for a
    // detector that had simply stopped working.
    expect(evaluate(result.candidates[0], ruleSet).kind).toBe("pass");
  });

  /**
   * THE FAIL-DIRECTION PROOF for the vendor-prefix rule (O-004 audits, D10).
   *
   * `$feature_flag_called` is not on the denylist and never will be — the
   * vendor namespace grows with every PostHog release, so no list can
   * enumerate it. It fires automatically, routinely moments after page load.
   *
   * Before the prefix rule it became `precedingActionName`, producing the only
   * signal `brokenProofSignals` admits, and the gate then told a founder "We
   * could prove the thing they were trying to do failed on them" when nobody
   * was trying to do anything. Both O-004 audits reproduced it independently.
   *
   * The assertion is on the CLAIM, not just the signal: proving no correlation
   * exists is weaker than proving no false verdict reaches the customer.
   */
  test("should not name an unlisted vendor event as the action an exception broke", () => {
    const ruleSet = ruleSetV1();
    const unlistedVendorEvent = "$feature_flag_called";
    expect(ruleSet.passiveEventNames).not.toContain(unlistedVendorEvent);
    expect(ruleSet.userInitiatedVendorEvents).not.toContain(unlistedVendorEvent);

    const result = detectErrorEvent(
      t1psvCorpus(
        t1psvPassiveThenException({
          count: ruleSet.errorMinAffectedSessions,
          passiveName: unlistedVendorEvent,
          exceptionName: ruleSet.exceptionEventName,
          exceptionAt: FIXTURE_EXCEPTION_AT,
          gapMs: T1PSV_GAP_MS,
        }),
      ),
      ruleSet,
    );

    const correlated = correlatedSignalsOf(result);
    expect(correlated.some((signal) => signal.precedingActionName === unlistedVendorEvent)).toBe(
      false,
    );

    // The direction, stated as an assertion: with no action to name, the
    // `broken` claim has no admissible proof and must NOT pass. Silence is the
    // correct output here.
    const candidate = result.candidates[0];
    if (candidate !== undefined) {
      const outcome = evaluate(candidate, ruleSet);
      // Either the claim was dropped outright, or it survived as something
      // weaker. What must never happen is `broken` — that is the class whose
      // sentence asserts we PROVED the user's action failed.
      if (outcome.kind === "pass") {
        expect(outcome.finalClass).not.toBe("broken");
      }
    }
  });

  test("should treat an unlisted event name as an ordinary action, so the denylist is data", () => {
    const ruleSet = ruleSetV1();
    const [passiveName] = ruleSet.passiveEventNames;
    // The SAME corpus, judged under a rule set whose denylist is empty. A
    // detector with the names inlined would still refuse; one reading the rule
    // set correlates. This is D-14 asserted, not claimed.
    // Both name lists cleared, because passivity is now decided by TWO rules
    // that compose: the explicit denylist, and "an unknown vendor-prefixed
    // event is passive" (the D10 fail-direction fix). Naming the event as
    // user-initiated is how a rule set says "this one IS an action" — so this
    // now proves D-14 for both lists rather than one.
    const permissive: ThresholdRuleSet = {
      ...ruleSet,
      passiveEventNames: [],
      userInitiatedVendorEvents: [...ruleSet.userInitiatedVendorEvents, passiveName ?? ""],
    };

    const sessions = t1psvPassiveThenException({
      count: ruleSet.errorMinAffectedSessions,
      passiveName: passiveName ?? "",
      exceptionName: ruleSet.exceptionEventName,
      exceptionAt: FIXTURE_EXCEPTION_AT,
      gapMs: T1PSV_GAP_MS,
    });

    const correlated = correlatedSignalsOf(detectErrorEvent(t1psvCorpus(sessions), permissive));
    expect(correlated.length).toBe(ruleSet.errorMinAffectedSessions);
    expect(correlated.every((signal) => signal.precedingActionName === passiveName)).toBe(true);
  });

  // The asymmetry with PL ruling 27, asserted rather than merely commented: an
  // exception SKIPS (a real action before it survives), a passive event
  // CLEARS. A click, then a navigation, then an error on the new page is the
  // same over-attribution one step removed — the click was on a page the user
  // has already left.
  test("should not carry an action across a passive event to a later exception", () => {
    const ruleSet = ruleSetV1();

    const sessions = Array.from({ length: ruleSet.errorMinAffectedSessions }, (_unused, i) =>
      t1psvSession(i, [
        t1psvEvent(
          `t1psv-e${i}-action`,
          T1PSV_ACTION,
          before(FIXTURE_EXCEPTION_AT, T1PSV_GAP_MS * 2),
        ),
        t1psvEvent(
          `t1psv-e${i}-passive`,
          ruleSet.passiveEventNames[0] ?? "",
          before(FIXTURE_EXCEPTION_AT, T1PSV_GAP_MS),
        ),
        t1psvEvent(`t1psv-e${i}-exception`, ruleSet.exceptionEventName, FIXTURE_EXCEPTION_AT),
      ]),
    );

    // Fixture self-check: the ACTION itself is still inside the correlation
    // window, so only the clearing rule can keep it from being named.
    expect(T1PSV_GAP_MS * 2).toBeLessThan(ruleSet.errorCorrelationWindowMs);

    const result = detectErrorEvent(t1psvCorpus(sessions), ruleSet);

    expect(result.candidates).toHaveLength(1);
    expect(correlatedSignalsOf(result)).toEqual([]);
    expect(uncorrelatedSignalsOf(result).length).toBe(ruleSet.errorMinAffectedSessions);
  });
});

// ---------------------------------------------------------------------------
// PL RULING 17, END TO END — the detector emits, the gate drops (ES-13)
// ---------------------------------------------------------------------------
//
// WHY THIS IS COMPOSED RATHER THAN SPLIT. Ruling 17's claim spans two pure
// functions: `detectErrorEvent` EMITS a `broken` candidate for an
// uncorrelated-only corpus, and `evaluate` then DROPS it. Every test above
// this line covers the first half; `gate.test.ts` covers the second against
// hand-built signals. The ADD quotes D11 on exactly this shape — a producer
// test plus a consumer test does not prove the wire between them, and O-003
// shipped a dead wire with three green tests either side of it.
//
// Both halves are pure functions in one package, so composing them is cheap
// and there is no excuse for asserting the claim in two pieces.
//
// The path being pinned: an exception nobody can tie to a preceding action is
// recorded HONESTLY as `failure_uncorrelated` (never invented as
// `failure_correlated`), which is NOT admissible proof of `broken` (D-11), so
// the claim downgrades to `confusing`, finds no struggle signal — this
// detector produces none — and hits the FR-13B floor. Final answer: DROP.
// Silence, with the whole descent visible in the trace.
describe("detectErrorEvent -> evaluate — an uncorrelated-only corpus drops (ruling 17, ES-13)", () => {
  test("should emit a broken candidate carrying failure_uncorrelated that the gate then drops", () => {
    const ruleSet = ruleSetV1();

    const result = detectErrorEvent(
      corpusOf(
        sessionsWithLoneException({
          count: ruleSet.errorMinAffectedSessions,
          exceptionName: ruleSet.exceptionEventName,
          exceptionAt: FIXTURE_EXCEPTION_AT,
        }),
      ),
      ruleSet,
    );

    // (1) THE DETECTOR EMITS. A candidate is produced — ruling 17 is explicit
    // that an uncorrelated-only corpus is NOT silently swallowed at this
    // layer, because the signal must stay visible in the trace.
    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0];
    expect(candidate.claimedClass).toBe("broken");

    // ...carrying the HONEST signal, and never a fabricated correlation.
    expect(uncorrelatedSignalsOf(result).length).toBeGreaterThan(0);
    expect(correlatedSignalsOf(result)).toEqual([]);

    // (2) THE GATE DROPS IT — driven through the gate's real entry point with
    // the detector's real output, not a hand-built claim.
    const outcome = evaluate(candidate, ruleSet);

    expect(outcome.kind).toBe("drop");

    // (3) AND THE DESCENT IS VISIBLE. Both rungs evaluated, both unsatisfied,
    // and `changed_mind` never reached — the FR-13B floor doing its job on a
    // real detector's output rather than on a fixture.
    expect(outcome.trace.map((entry) => entry.class)).toEqual(["broken", "confusing"]);
    expect(outcome.trace.every((entry) => entry.satisfied === false)).toBe(true);
    expect(outcome.trace.some((entry) => entry.class === "changed_mind")).toBe(false);

    // NON-VACUITY, and the point of the whole exercise: the SAME corpus with a
    // preceding action to correlate against PASSES as `broken`. So the drop
    // above is the uncorrelated signal being refused, never a fixture that
    // could not have passed whatever it carried.
    const correlatedResult = detectErrorEvent(
      corpusOf(
        sessionsWithPrecedingAction({
          count: ruleSet.errorMinAffectedSessions,
          actionName: "save_profile",
          exceptionName: ruleSet.exceptionEventName,
          exceptionAt: FIXTURE_EXCEPTION_AT,
          gapMs: Math.floor(ruleSet.errorCorrelationWindowMs / 2),
        }),
      ),
      ruleSet,
    );

    const correlatedOutcome = evaluate(correlatedResult.candidates[0], ruleSet);
    expect(correlatedOutcome.kind).toBe("pass");
  });
});

// ===========================================================================
// PL RULING 25 — `error_event.counts` IS EXACTLY ONE ENTRY, AND IT MEANS
// SOMETHING (ADD §7, D-7, D-8, FR-10)
//
// THE GAP THIS CLOSES, verbatim. Until this block, NOTHING in this file read
// `candidate.counts` at all — every `count` token above is a fixture-helper
// parameter. Replacing the whole `counts:` array in `error-event.ts` with `[]`,
// or setting its numerator to `corpus.basis.kept`, broke no test.
// `proposedClaimSchema` does not constrain the array's length either, so the
// gate-integration tests did not cover it. The detector's ONLY magnitude — the
// number a founder actually reads — was unpinned.
//
// WHAT IS PINNED HERE, and why each half matters:
//   (1) EXACTLY ONE ENTRY (ruling 25). Ruling 15 declares `funnel_dropoff`'s
//       two-entry array by position; nothing declared this one until now. A
//       second entry appearing silently changes what "the count" means for
//       every downstream reader that indexes `counts[0]`.
//   (2) THE NUMERATOR BY VALUE — sessions on THIS surface carrying the
//       exception. Every fixture below is built so the expected number is
//       UNAMBIGUOUS and DIFFERENT from `basis.kept`, so a regression to
//       `numerator: corpus.basis.kept` (a permanent, meaningless 100%) fails
//       here rather than shipping "3 of 3 sessions" for every finding.
//   (3) THE DENOMINATOR IS `basis.kept` (D-7, FR-7). A set-aside session never
//       had the opportunity, so it is not in the denominator; and a count that
//       can reach a customer without its denominator is what D-8 exists to
//       prevent.
//
// LANE PREFIX `t1cnt`, shared with no other suite (ADD §6.5), with its own
// surfaces, its own session ids, and its own corpus builder. Fixture time is a
// REQUIRED PARAMETER on every helper below; nothing here reads a clock.
// ===========================================================================

const T1CNT_SURFACE = "/t1cnt/settings";
/** A SECOND surface, so "the numerator is per-surface" is asserted rather than
 * accidentally true of a single-surface corpus. */
const T1CNT_OTHER_SURFACE = "/t1cnt/billing";
const T1CNT_ACTION = "t1cnt_save_clicked";
/** The gap between the action and the exception — well inside the correlation
 * window, so the counts under test are never an artefact of a missed window. */
const T1CNT_GAP_MS = 2_000;

function t1cntEvent(id: string, name: string, occurredAt: Date, urlPath: string): TimelineEvent {
  return {
    sourceEventId: id,
    name,
    occurredAt,
    urlPath,
    urlPathNormalisationVersion: 1,
  };
}

function t1cntSession(
  key: string,
  urlPath: string,
  events: readonly TimelineEvent[],
): SessionTimeline {
  return {
    sessionId: `t1cnt-session-${key}`,
    startedAt: FIXTURE_WINDOW.start,
    exclusionReason: "none",
    entryUrlPath: urlPath,
    events,
  };
}

/** One session that reaches `urlPath` and throws `exceptionsPerSession` times
 * there, each preceded by a real action. */
function t1cntAffectedSession(input: {
  readonly key: string;
  readonly urlPath: string;
  readonly exceptionName: string;
  readonly exceptionsPerSession: number;
  readonly firstExceptionAt: Date;
  readonly gapMs: number;
}): SessionTimeline {
  const events = Array.from({ length: input.exceptionsPerSession }, (_unused, n) => {
    const exceptionAt = after(input.firstExceptionAt, n * input.gapMs * 2);
    return [
      t1cntEvent(
        `t1cnt-${input.key}-action-${n}`,
        T1CNT_ACTION,
        before(exceptionAt, input.gapMs),
        input.urlPath,
      ),
      t1cntEvent(
        `t1cnt-${input.key}-exception-${n}`,
        input.exceptionName,
        exceptionAt,
        input.urlPath,
      ),
    ];
  }).flat();

  return t1cntSession(input.key, input.urlPath, events);
}

/** A KEPT session that reaches the same surface and throws nothing. It is in
 * `basis.kept` — the denominator — and in no numerator. This is the session
 * that makes `numerator === basis.kept` a FAILING answer. */
function t1cntQuietSession(key: string, urlPath: string): SessionTimeline {
  return t1cntSession(key, urlPath, [
    t1cntEvent(
      `t1cnt-${key}-action`,
      T1CNT_ACTION,
      before(FIXTURE_EXCEPTION_AT, T1CNT_GAP_MS),
      urlPath,
    ),
  ]);
}

/** Every fixture session here is KEPT, so `basis.kept === sessions.length` and
 * the denominator under test is unambiguous. */
function t1cntCorpus(sessions: readonly SessionTimeline[]): DetectorCorpus {
  const basis: CountBasis = {
    totalInWindow: sessions.length,
    kept: sessions.length,
    setAside: [],
  };
  return {
    projectId: "t1cnt-project",
    window: FIXTURE_WINDOW,
    connectionState: T1ERR_CONNECTION_STATE,
    sessions,
    basis,
    coverage: { truncated: false, eventsWithoutUrlPath: 0 },
  };
}

/** Throws rather than returning `undefined`, so a mis-keyed lookup is a loud
 * fixture bug instead of a silent `expect(undefined)`. */
function candidateForSurface(result: DetectorResult, surface: string): DetectorCandidate {
  const candidate = result.candidates.find((entry) => entry.surface === surface);
  if (!candidate) {
    throw new Error(`no error_event candidate was emitted for surface "${surface}"`);
  }
  return candidate;
}

describe("detectErrorEvent — counts (PL ruling 25, D-7, D-8, FR-10)", () => {
  test("should emit exactly one count, over basis.kept, whose numerator is the affected sessions", () => {
    const ruleSet = ruleSetV1();
    const affected = ruleSet.errorMinAffectedSessions;
    const quiet = affected + 1;

    const corpus = t1cntCorpus([
      ...Array.from({ length: affected }, (_unused, i) =>
        t1cntAffectedSession({
          key: `hit-${i}`,
          urlPath: T1CNT_SURFACE,
          exceptionName: ruleSet.exceptionEventName,
          exceptionsPerSession: 1,
          firstExceptionAt: FIXTURE_EXCEPTION_AT,
          gapMs: T1CNT_GAP_MS,
        }),
      ),
      ...Array.from({ length: quiet }, (_unused, i) =>
        t1cntQuietSession(`quiet-${i}`, T1CNT_SURFACE),
      ),
    ]);

    // FIXTURE SELF-CHECK, and the whole point of the shape above: the expected
    // numerator is NOT the denominator. A detector that reported
    // `numerator: corpus.basis.kept` — a permanent 100% — would pass a fixture
    // where every kept session was affected, and this is what stops that.
    expect(corpus.basis.kept).toBe(affected + quiet);
    expect(affected).not.toBe(corpus.basis.kept);

    const candidate = candidateForSurface(detectErrorEvent(corpus, ruleSet), T1CNT_SURFACE);

    // (1) RULING 25: EXACTLY ONE ENTRY. Not zero — an empty array strips the
    // detector of its only magnitude — and not two, which would silently
    // change what `counts[0]` means for every downstream reader.
    expect(candidate.counts).toHaveLength(1);

    const [count] = candidate.counts;

    // (2) THE NUMERATOR, BY VALUE. Sessions on this surface carrying the
    // exception — five kept sessions, three of which threw.
    expect(count.numerator).toBe(affected);
    expect(count.numerator).not.toBe(count.denominator);
    expect(count.numerator).not.toBe(corpus.basis.kept);

    // (3) THE DENOMINATOR IS `basis.kept` (D-7, FR-7), and the count carries
    // the whole basis with it, so it cannot reach a customer bare (D-8).
    expect(count.denominator).toBe(corpus.basis.kept);
    expect(count.unit).toBe("sessions");
    expect(count.timeframe).toEqual(FIXTURE_WINDOW);
    expect(count.basis).toEqual(corpus.basis);
    expect(isMeasuredCount(count)).toBe(true);
  });

  test("should count each affected session once however many exceptions it threw", () => {
    const ruleSet = ruleSetV1();
    const affected = ruleSet.errorMinAffectedSessions;
    const exceptionsPerSession = 3;
    const quiet = 2;

    const corpus = t1cntCorpus([
      ...Array.from({ length: affected }, (_unused, i) =>
        t1cntAffectedSession({
          key: `multi-${i}`,
          urlPath: T1CNT_SURFACE,
          exceptionName: ruleSet.exceptionEventName,
          exceptionsPerSession,
          firstExceptionAt: FIXTURE_EXCEPTION_AT,
          gapMs: T1CNT_GAP_MS,
        }),
      ),
      ...Array.from({ length: quiet }, (_unused, i) =>
        t1cntQuietSession(`multi-quiet-${i}`, T1CNT_SURFACE),
      ),
    ]);

    const result = detectErrorEvent(corpus, ruleSet);
    const candidate = candidateForSurface(result, T1CNT_SURFACE);

    // NON-VACUITY: there really are more exceptions than sessions here, so
    // "sessions, not events" is a distinction this fixture can see. A detector
    // reporting `group.signals.length` would say nine.
    expect(candidate.signals.length).toBe(affected * exceptionsPerSession);

    expect(candidate.counts).toHaveLength(1);
    expect(candidate.counts[0].numerator).toBe(affected);
    expect(candidate.counts[0].denominator).toBe(corpus.basis.kept);
    // The unit is `sessions`, and it means it — a per-event numerator would
    // let one noisy session read as an outage.
    expect(candidate.counts[0].unit).toBe("sessions");
  });

  test("should count sessions per surface while every candidate shares the one kept denominator", () => {
    const ruleSet = ruleSetV1();
    const onSurface = ruleSet.errorMinAffectedSessions;
    const onOtherSurface = ruleSet.errorMinAffectedSessions + 1;

    const corpus = t1cntCorpus([
      ...Array.from({ length: onSurface }, (_unused, i) =>
        t1cntAffectedSession({
          key: `split-a-${i}`,
          urlPath: T1CNT_SURFACE,
          exceptionName: ruleSet.exceptionEventName,
          exceptionsPerSession: 1,
          firstExceptionAt: FIXTURE_EXCEPTION_AT,
          gapMs: T1CNT_GAP_MS,
        }),
      ),
      ...Array.from({ length: onOtherSurface }, (_unused, i) =>
        t1cntAffectedSession({
          key: `split-b-${i}`,
          urlPath: T1CNT_OTHER_SURFACE,
          exceptionName: ruleSet.exceptionEventName,
          exceptionsPerSession: 1,
          firstExceptionAt: FIXTURE_EXCEPTION_AT,
          gapMs: T1CNT_GAP_MS,
        }),
      ),
    ]);

    const result = detectErrorEvent(corpus, ruleSet);
    expect(result.candidates).toHaveLength(2);

    const first = candidateForSurface(result, T1CNT_SURFACE);
    const second = candidateForSurface(result, T1CNT_OTHER_SURFACE);

    // Two DIFFERENT numerators, so neither can be the corpus-wide session
    // count wearing a surface's name...
    expect(first.counts).toHaveLength(1);
    expect(second.counts).toHaveLength(1);
    expect(first.counts[0].numerator).toBe(onSurface);
    expect(second.counts[0].numerator).toBe(onOtherSurface);
    expect(first.counts[0].numerator).not.toBe(second.counts[0].numerator);

    // ...and ONE denominator, so O-007 can render "3 of 7 sessions" and
    // "4 of 7 sessions" from the same population (D-7).
    expect(first.counts[0].denominator).toBe(corpus.basis.kept);
    expect(second.counts[0].denominator).toBe(corpus.basis.kept);
    expect(corpus.basis.kept).toBe(onSurface + onOtherSurface);
  });
});
