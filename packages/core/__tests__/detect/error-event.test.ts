// Unit tests for `error_event`: the eight named contract tests.
//
// Two of these carry most of the weight:
//
// "should match the exception name from the rule set, never an inlined
//  literal". It is written so it fails if anyone inlines
//  `"$exception"`: the rule set handed in names a different event, and the
//  detector must follow the rule set. The literal `"$exception"` appears in
//  the same corpus as a decoy and must be ignored.
//
// "should emit an explicitly absent correlation for an exception with no
//  preceding action, never a fabricated one". This is what stops an
//  `$exception` unrelated to the user's action laundering into a `broken`
//  claim. An uncorrelated exception is recorded honestly as
//  `failure_uncorrelated`; `failure_correlated` must never be invented for
//  it. (That `failure_uncorrelated` is then not admissible proof of `broken`
//  is the gate's half of the contract, asserted in the predicates suite.)
//
// Clock: there is no `now` parameter anywhere in this package. The suite's instants are
// fixture constants passed explicitly into every helper. No helper here reads
// `Date.now`, so no test in this file can be time-of-day flaky.
//
// Boundaries: inclusive, everywhere. A correlation holds at `delta <=
// errorCorrelationWindowMs`; one millisecond beyond does not.
//
// Lane prefix: every fixture id, session id, event name, and path in this file is
// prefixed `t1err`. A new prefix, shared with no other suite. The passive-event
// denylist suite added later in this file runs in its own lane, `t1psv`, with its own
// surface, its own session ids, and its own corpus builder, so neither set of fixtures
// can be read as the other's.
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

// Fixture time, required parameters, never a clock read

/** The suite's analysis window. A fixed instant pair, passed in explicitly. */
const FIXTURE_WINDOW: AnalysisWindow = {
  start: new Date("2026-05-01T00:00:00.000Z"),
  end: new Date("2026-05-08T00:00:00.000Z"),
};

/** The instant every fixture exception occurs at, well inside the window. */
const FIXTURE_EXCEPTION_AT = new Date("2026-05-04T09:00:00.000Z");

/** `base` shifted backward by `offsetMs`. Both are parameters; nothing here consults a
 * clock. */
function before(base: Date, offsetMs: number): Date {
  return new Date(base.getTime() - offsetMs);
}

/** `base` shifted forward by `offsetMs`. */
function after(base: Date, offsetMs: number): Date {
  return new Date(base.getTime() + offsetMs);
}

// Fixture vocabulary, all `t1err`-prefixed, colliding with no other suite

const T1ERR_SURFACE = "/t1err/checkout";
const T1ERR_ACTION = "t1err_submit_clicked";
const T1ERR_LATER_ACTION = "t1err_retry_clicked";
/** The exception name used when the rule set is v1's own. */
const T1ERR_VENDOR_EXCEPTION = "$exception";
/** A different exception name, used to prove the detector reads the rule set. */
const T1ERR_RENAMED_EXCEPTION = "t1err_thrown_by_another_vendor";

/** The v1 rule set fetched by version, never "whatever is current". */
function ruleSetV1(): ThresholdRuleSet {
  const rules = THRESHOLD_RULE_SETS.get(1);
  if (!rules) throw new Error("threshold rule set version 1 must remain resolvable forever");
  return rules;
}

/** The same rule set with a different exception name. The whole point of: a vendor name
 * change is a rule-set edit, not a detector edit. */
function withExceptionName(base: ThresholdRuleSet, exceptionEventName: string): ThresholdRuleSet {
  return { ...base, exceptionEventName };
}

// Corpus builders

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
    // Every fixture session is kept, so `basis.kept` is the whole corpus and the
    // filtering is not what any assertion in this file turns on.
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

// Signal readers

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

describe("detectErrorEvent", () => {
  // /. The load-bearing test of the whole file: the name is data, not code. Written to
  // fail if `"$exception"` is inlined in the detector body. The rule set names a
  // different event, and `"$exception"` is present in the same corpus as a decoy that
  // must be ignored.
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

    // The same corpus shape carrying the vendor literal, judged under a rule set that
    // does not name it. A detector reading the rule set sees no exception here at all;
    // a detector with the literal inlined sees three.
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

  // The ordinary case: an exception tied to the action that preceded it.
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

  //  /. Inclusive: it fires AT the threshold, not one below it.
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

  // Fail direction: Under-detect. One millisecond beyond the window is a coincidence,
  // and a coincidence dressed as a cause is the over-permissive predicate the prd names
  // as a High risk.
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

  // . The other load-bearing test. An exception with nothing before it must be
  // recorded as an explicitly absent correlation, never as a fabricated one. This is
  // what stops an unrelated exception laundering into a `broken` claim.
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

    // And the exception is not silently dropped either. Absence is stated.
    const uncorrelated = uncorrelatedSignalsOf(result);
    expect(uncorrelated.length).toBe(ruleSet.errorMinAffectedSessions);
    expect(uncorrelated.every((s) => s.eventName === ruleSet.exceptionEventName)).toBe(true);
    expect(
      uncorrelated.every((s) => s.occurredAt.getTime() === FIXTURE_EXCEPTION_AT.getTime()),
    ).toBe(true);
  });

  // Fail direction: Under-detect. One session with an exception is an anecdote; the
  // rule set's magnitude is what makes it not a finding.
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

  // / oq-e, and: there is no `now`. The anchor is the exception's own `occurredAt`, and
  // the search runs backward. A session here carries an action on each side of the
  // exception, both inside the window. Only a backward-looking detector names the
  // earlier one.
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

  // The front door. `changed_mind`'s proof is satisfied by the absence of everything,
  // so a deterministic detector proposing it renders "we detected nothing" as "we
  // detected a user decision". No T1 detector may do it. On a correlated corpus, an
  // uncorrelated one, or a clean one.
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

    // Non-vacuity: this corpus does produce candidates, so the assertion below is about
    // what they claim rather than about there being none.
    expect(classes.length).toBeGreaterThan(0);
    expect(classes).not.toContain("changed_mind");
  });
});

// A "preceding action" is never another exception (Wave 7, 6.7)
//
// The gap this closes. `detectErrorEvent` skips other exceptions when choosing an
// exception's correlation partner, and until now nothing asserted it.
//
// Why it matters. Naming one exception as the cause of the next manufactures a
// `failure_correlated` out of two failures, and `failure_correlated` is the only
// admissible proof of `broken` (BROKEN_PROOF_SIGNALS_V1). A fabricated one walks
// straight through the evidence gate as a passing `broken` claim, which is the precise
// outcome the gate exists to prevent and the over-permissive predicate the prd names as
// a High risk. Skipping exceptions can only ever produce fewer correlations, so it is
// strictly the under-detect direction.
//
// Every fixture below reuses this file's `t1err` lane, its frozen instants, and its
// explicit-parameter helpers. No `Date.now` is introduced.

/** Deliberately well inside `errorCorrelationWindowMs`, so a detector that took the
 * nearest earlier event verbatim would name the first exception as the second's cause.
 * The window is what must not be doing the work here. */
const T1ERR_CONSECUTIVE_GAP_MS = 1_000;

/** `n` sessions, each carrying two exceptions back to back with no user action between
 * them, nor anywhere else in the session. */
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

/** The control: the same two exceptions, with a genuine user action sitting between
 * them. Proves the skip is narrow. It removes exceptions from candidacy and nothing
 * else. */
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

    // Fixture self-check: the two exceptions sit well inside one another's correlation
    // window, so only the exception skip can keep them apart. If the window were doing
    // the work, this test would prove nothing.
    expect(T1ERR_CONSECUTIVE_GAP_MS).toBeLessThan(ruleSet.errorCorrelationWindowMs);

    const result = consecutiveExceptionsResult(ruleSet);

    // Non-vacuity: the corpus clears `errorMinAffectedSessions` and emits a candidate,
    // so an empty correlated list is the skip working rather than the detector having
    // found nothing at all.
    expect(result.candidates).toHaveLength(1);

    // A `failure_correlated` built from two failures is a fabricated `broken` claim.
    // The one signal kind the gate admits as proof of `broken`.
    expect(correlatedSignalsOf(result)).toEqual([]);
  });

  test("should record the second of two consecutive exceptions as failure_uncorrelated", () => {
    const ruleSet = ruleSetV1();
    const secondExceptionAt = after(FIXTURE_EXCEPTION_AT, T1ERR_CONSECUTIVE_GAP_MS);

    const uncorrelated = uncorrelatedSignalsOf(consecutiveExceptionsResult(ruleSet));

    // Both exceptions in every session: the first has nothing before it, and the second
    // has only the first, which does not count. Neither is silently dropped; 's
    // absence is stated, not implied by silence.
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

    // The control half. Ruling 27 costs no genuine correlation: a real action between
    // two exceptions is still named, and it is named for the second exception. The one
    // the skip could have mis-attributed.
    expect(correlated.length).toBe(ruleSet.errorMinAffectedSessions);
    expect(correlated.every((signal) => signal.precedingActionName === T1ERR_ACTION)).toBe(true);
    expect(
      correlated.every((signal) => signal.precedingActionName !== ruleSet.exceptionEventName),
    ).toBe(true);
    expect(
      correlated.every((signal) => signal.occurredAt.getTime() === secondExceptionAt.getTime()),
    ).toBe(true);

    // The first exception still has nothing before it and is still recorded as an
    // explicitly absent correlation rather than dropped.
    const uncorrelated = uncorrelatedSignalsOf(result);
    expect(uncorrelated.length).toBe(ruleSet.errorMinAffectedSessions);
    expect(
      uncorrelated.every(
        (signal) => signal.occurredAt.getTime() === FIXTURE_EXCEPTION_AT.getTime(),
      ),
    ).toBe(true);
  });
});

// The passive-event denylist, a page load is not something a user was trying to do (
// product decisions, edge taxonomy)
//
// The defect this closes, verbatim. `collectSession` used to promote every
// non-exception event to "the preceding action". So a `$pageview` at page load,
// followed within `errorCorrelationWindowMs` by a third-party script error, an
// ad-blocker-induced fetch failure, or an SDK-captured console error, emitted
// `failure_correlated { precedingActionName: "$pageview" }`.
//
// Why that was the worst possible over-detect. `failure_correlated` is the only member
// of `BROKEN_PROOF_SIGNALS_V1`. Three such sessions on one surface therefore passed the
// evidence gate, and the customer read `broken_satisfied`. "We could prove the thing
// they were trying to do failed on them". When nobody was trying to do anything. A
// wrong verdict rendered in the customer's own words is precisely what the "no verdict
// beats a wrong verdict" and exist to prevent, and a predicate firing on a superset of
// its real target is the conflation this whole sprint exists to prevent.
//
// Every fixture above this line used a named click, which is why none of them caught
// it.
//
// Fail direction: Under-detect. A passive event does not merely fail to become the
// action. It clears a real one, because `$pageview`/`$pageleave` mark a navigation and
// an earlier click was on a page the user has left. That can only ever produce fewer
// correlations, and a missed correlation degrades `broken` -> `confusing` -> drop,
// which ruling 17 already established as the recoverable direction.
//
// Lane prefix `t1psv`, shared with no other suite. Fixture time is a required parameter
// on every helper below; nothing here reads a clock.

const T1PSV_SURFACE = "/t1psv/pricing";
/** A real interaction, the control lane's action. */
const T1PSV_ACTION = "t1psv_plan_selected";
/** The gap between the passive event and the exception. Deliberately well inside
 * `errorCorrelationWindowMs`, so only the denylist can keep them apart: if the window
 * were doing the work, the test would prove nothing. */
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

/** `n` sessions, each a single passive event followed `gapMs` later by an exception.
 * The production shape: a page load, then a third-party error. */
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

/** The acceptance shape: `$pageview -> interaction -> $exception`. The interaction is
 * what must be named, and it arrives after the passive event, so clearing on the
 * passive event costs this shape nothing. */
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

describe("detectErrorEvent — a passive event is never the preceding action", () => {
  // The fail-direction test for `passiveEventNames`. Its name is what
  // `coverage.test.ts`'s `NAME_LIST_FAIL_DIRECTION_TESTS` row points at. Do not rename
  // it without repointing that row.
  test("should not name a passive page event as the action an exception broke", () => {
    const ruleSet = ruleSetV1();

    // Fixture self-checks. Both matter: the denylist must really carry the name under
    // test, and the gap must sit inside the correlation window, or this test would pass
    // for the wrong reason.
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

    // Non-vacuity: the corpus clears `errorMinAffectedSessions` and does open a
    // candidate, so an empty correlated list below is the denylist working rather than
    // the detector having found nothing at all.
    expect(result.candidates).toHaveLength(1);

    //  nothing is fabricated. A `failure_correlated` here would be the only signal
    // the gate admits as proof of `broken`, built out of a page load.
    expect(correlatedSignalsOf(result)).toEqual([]);

    //  and the exception is not silently dropped either. Absence of a
    // correlation is stated, per exception, per session.
    const uncorrelated = uncorrelatedSignalsOf(result);
    expect(uncorrelated.length).toBe(ruleSet.errorMinAffectedSessions);
    expect(uncorrelated.every((signal) => signal.eventName === ruleSet.exceptionEventName)).toBe(
      true,
    );
  });

  // The whole point, driven through the gate's real entry point: the claim the detector
  // produces from a passive-only corpus must reach the customer as silence, not as
  // `broken_satisfied` in their own words (— a producer test plus a consumer test does
  // not prove the wire between them).
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
    // Both rungs evaluated and both unsatisfied: no admissible proof of `broken`, no
    // struggle to fall back on, then the floor.
    expect(outcome.trace.map((entry) => entry.class)).toEqual(["broken", "confusing"]);
    expect(outcome.trace.every((entry) => entry.satisfied === false)).toBe(true);
  });

  // Every member of the list, not just the first. A denylist with a name in it that
  // nothing exercises is a rule nobody has proven.
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

  // The control, and the reason this fix under-detects rather than simply detecting
  // nothing. Two halves:
  //
  //  the acceptance shape `$pageview -> interaction -> $exception`
  //  still correlates, to the interaction, and still passes the gate; and
  //  the name is data. A rule set that does not list the event treats it
  //  as an ordinary action, so this is a rule-set edit and not a detector
  //  edit.
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

    // ...and the claim it produces still reaches the customer as `broken`. Without this
    // half, "no correlations" would be an acceptable answer for a detector that had
    // simply stopped working.
    expect(evaluate(result.candidates[0], ruleSet).kind).toBe("pass");
  });

  /**
   * The fail-direction proof for the vendor-prefix rule (audits).
   *
   * `$feature_flag_called` is not on the denylist and never will be. The vendor
   * namespace grows with every PostHog release, so no list can enumerate it. It fires
   * automatically, routinely moments after page load.
   *
   * Before the prefix rule it became `precedingActionName`, producing the only signal
   * `brokenProofSignals` admits, and the gate then told a founder "We could prove the
   * thing they were trying to do failed on them" when nobody was trying to do anything.
   * Both audits reproduced it independently.
   *
   * The assertion is on the claim, not just the signal: proving no correlation exists
   * is weaker than proving no false verdict reaches the customer.
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

    // The direction, stated as an assertion: with no action to name, the `broken` claim
    // has no admissible proof and must not pass. Silence is the correct output here.
    const candidate = result.candidates[0];
    if (candidate !== undefined) {
      const outcome = evaluate(candidate, ruleSet);
      // Either the claim was dropped outright, or it survived as something weaker. What
      // must never happen is `broken`. That is the class whose sentence asserts we
      // proved the user's action failed.
      if (outcome.kind === "pass") {
        expect(outcome.finalClass).not.toBe("broken");
      }
    }
  });

  test("should treat an unlisted event name as an ordinary action, so the denylist is data", () => {
    const ruleSet = ruleSetV1();
    const [passiveName] = ruleSet.passiveEventNames;
    // The same corpus, judged under a rule set whose denylist is empty. A detector with
    // the names inlined would still refuse; one reading the rule set correlates. This
    // is asserted, not claimed. Both name lists cleared, because passivity is now
    // decided by two rules that compose: the explicit denylist, and "an unknown
    // vendor-prefixed event is passive" (the fail-direction fix). Naming the event as
    // user-initiated is how a rule set says "this one IS an action", so this now proves
    // for both lists rather than one.
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

  // The asymmetry with, asserted rather than merely commented: an exception skips (a
  // real action before it survives), a passive event clears. A click, then a
  // navigation, then an error on the new page is the same over-attribution one step
  // removed. The click was on a page the user has already left.
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

    // Fixture self-check: the action itself is still inside the correlation window, so
    // only the clearing rule can keep it from being named.
    expect(T1PSV_GAP_MS * 2).toBeLessThan(ruleSet.errorCorrelationWindowMs);

    const result = detectErrorEvent(t1psvCorpus(sessions), ruleSet);

    expect(result.candidates).toHaveLength(1);
    expect(correlatedSignalsOf(result)).toEqual([]);
    expect(uncorrelatedSignalsOf(result).length).toBe(ruleSet.errorMinAffectedSessions);
  });
});

// End to end. The detector emits, the gate drops
//
// Why this is composed rather than split. Ruling 17's claim spans two pure functions:
// `detectErrorEvent` emits a `broken` candidate for an uncorrelated-only corpus, and
// `evaluate` then drops it. Every test above this line covers the first half;
// `gate.test.ts` covers the second against hand-built signals. The add quotes on
// exactly this shape. A producer test plus a consumer test does not prove the wire
// between them, and shipped a dead wire with three green tests either side of it.
//
// Both halves are pure functions in one package, so composing them is cheap and there
// is no excuse for asserting the claim in two pieces.
//
// The path being pinned: an exception nobody can tie to a preceding action is recorded
// honestly as `failure_uncorrelated` (never invented as `failure_correlated`), which is
// not admissible proof of `broken`, so the claim downgrades to `confusing`, finds no
// struggle signal (this detector produces none) and hits the floor. Final answer: Drop.
// Silence, with the whole descent visible in the trace.
describe("detectErrorEvent -> evaluate — an uncorrelated-only corpus drops", () => {
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

    //  the detector emits. A candidate is produced. Ruling 17 is explicit that an
    // uncorrelated-only corpus is not silently swallowed at this layer, because the
    // signal must stay visible in the trace.
    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0];
    expect(candidate.claimedClass).toBe("broken");

    // ...carrying the honest signal, and never a fabricated correlation.
    expect(uncorrelatedSignalsOf(result).length).toBeGreaterThan(0);
    expect(correlatedSignalsOf(result)).toEqual([]);

    //  the gate drops it. Driven through the gate's real entry point with the
    // detector's real output, not a hand-built claim.
    const outcome = evaluate(candidate, ruleSet);

    expect(outcome.kind).toBe("drop");

    //  and the descent is visible. Both rungs evaluated, both unsatisfied, and
    // `changed_mind` never reached. The floor doing its job on a real detector's output
    // rather than on a fixture.
    expect(outcome.trace.map((entry) => entry.class)).toEqual(["broken", "confusing"]);
    expect(outcome.trace.every((entry) => entry.satisfied === false)).toBe(true);
    expect(outcome.trace.some((entry) => entry.class === "changed_mind")).toBe(false);

    // Non-vacuity, and the point of the whole exercise: the same corpus with a
    // preceding action to correlate against passes as `broken`. So the drop above is
    // the uncorrelated signal being refused, never a fixture that could not have passed
    // whatever it carried.
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

// `error_event.counts` is exactly one entry, and it means something
//
// The gap this closes, verbatim. Until this block, nothing in this file read
// `candidate.counts` at all. Every `count` token above is a fixture-helper parameter.
// Replacing the whole `counts:` array in `error-event.ts` with `[]`, or setting its
// numerator to `corpus.basis.kept`, broke no test. `proposedClaimSchema` does not
// constrain the array's length either, so the gate-integration tests did not cover it.
// The detector's only magnitude (the number a founder actually reads) was unpinned.
//
// What is pinned here, and why each half matters: exactly one entry (ruling 25).
// Ruling 15 declares `funnel_dropoff`'s
//  two-entry array by position; nothing declared this one until now. A
//  second entry appearing silently changes what "the count" means for
//  every downstream reader that indexes `counts[0]`.
//  the numerator by value. Sessions on this surface carrying the
//  exception. Every fixture below is built so the expected number is
//  Unambiguous and different from `basis.kept`, so a regression to
//  `numerator: corpus.basis.kept` (a permanent, meaningless 100%) fails
//  here rather than shipping "3 of 3 sessions" for every finding.
//  the denominator is `basis.kept`. A set-aside session never
//  had the opportunity, so it is not in the denominator; and a count that
//  can reach a customer without its denominator is what exists to
//  prevent.
//
// Lane prefix `t1cnt`, shared with no other suite, with its own surfaces, its own
// session ids, and its own corpus builder. Fixture time is a required parameter on
// every helper below; nothing here reads a clock.

const T1CNT_SURFACE = "/t1cnt/settings";
/** A second surface, so "the numerator is per-surface" is asserted rather than
 * accidentally true of a single-surface corpus. */
const T1CNT_OTHER_SURFACE = "/t1cnt/billing";
const T1CNT_ACTION = "t1cnt_save_clicked";
/** The gap between the action and the exception. Well inside the correlation window, so
 * the counts under test are never an artefact of a missed window. */
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

/** One session that reaches `urlPath` and throws `exceptionsPerSession` times there,
 * each preceded by a real action. */
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

/** A kept session that reaches the same surface and throws nothing. It is in
 * `basis.kept` (the denominator) and in no numerator. This is the session that makes
 * `numerator === basis.kept` a failing answer. */
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

/** Every fixture session here is kept, so `basis.kept === sessions.length` and the
 * denominator under test is unambiguous. */
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

/** Throws rather than returning `undefined`, so a mis-keyed lookup is a loud fixture
 * bug instead of a silent `expect(undefined)`. */
function candidateForSurface(result: DetectorResult, surface: string): DetectorCandidate {
  const candidate = result.candidates.find((entry) => entry.surface === surface);
  if (!candidate) {
    throw new Error(`no error_event candidate was emitted for surface "${surface}"`);
  }
  return candidate;
}

describe("detectErrorEvent — counts", () => {
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

    // Fixture self-check, and the whole point of the shape above: the expected
    // numerator is not the denominator. A detector that reported `numerator:
    // corpus.basis.kept` (a permanent 100%) would pass a fixture where every kept
    // session was affected, and this is what stops that.
    expect(corpus.basis.kept).toBe(affected + quiet);
    expect(affected).not.toBe(corpus.basis.kept);

    const candidate = candidateForSurface(detectErrorEvent(corpus, ruleSet), T1CNT_SURFACE);

    //  ruling 25: Exactly one entry. Not zero, an empty array strips the detector of
    // its only magnitude, and not two, which would silently change what `counts[0]`
    // means for every downstream reader.
    expect(candidate.counts).toHaveLength(1);

    const [count] = candidate.counts;

    //  the numerator, by value. Sessions on this surface carrying the exception.
    // Five kept sessions, three of which threw.
    expect(count.numerator).toBe(affected);
    expect(count.numerator).not.toBe(count.denominator);
    expect(count.numerator).not.toBe(corpus.basis.kept);

    //  the denominator is `basis.kept`, and the count carries the whole basis with
    // it, so it cannot reach a customer bare.
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

    // Non-vacuity: there really are more exceptions than sessions here, so "sessions,
    // not events" is a distinction this fixture can see. A detector reporting
    // `group.signals.length` would say nine.
    expect(candidate.signals.length).toBe(affected * exceptionsPerSession);

    expect(candidate.counts).toHaveLength(1);
    expect(candidate.counts[0].numerator).toBe(affected);
    expect(candidate.counts[0].denominator).toBe(corpus.basis.kept);
    // The unit is `sessions`, and it means it. A per-event numerator would let one
    // noisy session read as an outage.
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

    // Two different numerators, so neither can be the corpus-wide session count wearing
    // a surface's name...
    expect(first.counts).toHaveLength(1);
    expect(second.counts).toHaveLength(1);
    expect(first.counts[0].numerator).toBe(onSurface);
    expect(second.counts[0].numerator).toBe(onOtherSurface);
    expect(first.counts[0].numerator).not.toBe(second.counts[0].numerator);

    // ...and one denominator, so can render "3 of 7 sessions" and "4 of 7 sessions"
    // from the same population.
    expect(first.counts[0].denominator).toBe(corpus.basis.kept);
    expect(second.counts[0].denominator).toBe(corpus.basis.kept);
    expect(corpus.basis.kept).toBe(onSurface + onOtherSurface);
  });
});
