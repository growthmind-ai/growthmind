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

const FIXTURE_WINDOW: AnalysisWindow = {
  start: new Date("2026-05-01T00:00:00.000Z"),
  end: new Date("2026-05-08T00:00:00.000Z"),
};

const FIXTURE_EXCEPTION_AT = new Date("2026-05-04T09:00:00.000Z");

function before(base: Date, offsetMs: number): Date {
  return new Date(base.getTime() - offsetMs);
}

function after(base: Date, offsetMs: number): Date {
  return new Date(base.getTime() + offsetMs);
}

const T1ERR_SURFACE = "/t1err/checkout";
const T1ERR_ACTION = "t1err_submit_clicked";
const T1ERR_LATER_ACTION = "t1err_retry_clicked";

const T1ERR_VENDOR_EXCEPTION = "$exception";

const T1ERR_RENAMED_EXCEPTION = "t1err_thrown_by_another_vendor";

function ruleSetV1(): ThresholdRuleSet {
  const rules = THRESHOLD_RULE_SETS.get(1);
  if (!rules) throw new Error("threshold rule set version 1 must remain resolvable forever");
  return rules;
}

function withExceptionName(base: ThresholdRuleSet, exceptionEventName: string): ThresholdRuleSet {
  return { ...base, exceptionEventName };
}

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

    exclusionReason: "none",
    entryUrlPath: T1ERR_SURFACE,
    events,
  };
}

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

    expect(correlatedSignalsOf(result)).toEqual([]);

    const uncorrelated = uncorrelatedSignalsOf(result);
    expect(uncorrelated.length).toBe(ruleSet.errorMinAffectedSessions);
    expect(uncorrelated.every((s) => s.eventName === ruleSet.exceptionEventName)).toBe(true);
    expect(
      uncorrelated.every((s) => s.occurredAt.getTime() === FIXTURE_EXCEPTION_AT.getTime()),
    ).toBe(true);
  });

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

    expect(correlated.every((s) => s.precedingActionName === T1ERR_ACTION)).toBe(true);
    expect(correlated.some((s) => s.precedingActionName === T1ERR_LATER_ACTION)).toBe(false);

    expect(correlated.every((s) => s.occurredAt.getTime() === FIXTURE_EXCEPTION_AT.getTime())).toBe(
      true,
    );
  });

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

      sessionOf(99, [
        timelineEvent("t1err-e99-action", T1ERR_ACTION, before(FIXTURE_EXCEPTION_AT, 5_000)),
      ]),
    ]);

    const classes = detectErrorEvent(corpus, ruleSet).candidates.map(
      (candidate): string => candidate.claimedClass,
    );

    expect(classes.length).toBeGreaterThan(0);
    expect(classes).not.toContain("changed_mind");
  });
});

const T1ERR_CONSECUTIVE_GAP_MS = 1_000;

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

    expect(T1ERR_CONSECUTIVE_GAP_MS).toBeLessThan(ruleSet.errorCorrelationWindowMs);

    const result = consecutiveExceptionsResult(ruleSet);

    expect(result.candidates).toHaveLength(1);

    expect(correlatedSignalsOf(result)).toEqual([]);
  });

  test("should record the second of two consecutive exceptions as failure_uncorrelated", () => {
    const ruleSet = ruleSetV1();
    const secondExceptionAt = after(FIXTURE_EXCEPTION_AT, T1ERR_CONSECUTIVE_GAP_MS);

    const uncorrelated = uncorrelatedSignalsOf(consecutiveExceptionsResult(ruleSet));

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

    expect(correlated.length).toBe(ruleSet.errorMinAffectedSessions);
    expect(correlated.every((signal) => signal.precedingActionName === T1ERR_ACTION)).toBe(true);
    expect(
      correlated.every((signal) => signal.precedingActionName !== ruleSet.exceptionEventName),
    ).toBe(true);
    expect(
      correlated.every((signal) => signal.occurredAt.getTime() === secondExceptionAt.getTime()),
    ).toBe(true);

    const uncorrelated = uncorrelatedSignalsOf(result);
    expect(uncorrelated.length).toBe(ruleSet.errorMinAffectedSessions);
    expect(
      uncorrelated.every(
        (signal) => signal.occurredAt.getTime() === FIXTURE_EXCEPTION_AT.getTime(),
      ),
    ).toBe(true);
  });
});

const T1PSV_SURFACE = "/t1psv/pricing";

const T1PSV_ACTION = "t1psv_plan_selected";

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
  test("should not name a passive page event as the action an exception broke", () => {
    const ruleSet = ruleSetV1();

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

    expect(result.candidates).toHaveLength(1);

    expect(correlatedSignalsOf(result)).toEqual([]);

    const uncorrelated = uncorrelatedSignalsOf(result);
    expect(uncorrelated.length).toBe(ruleSet.errorMinAffectedSessions);
    expect(uncorrelated.every((signal) => signal.eventName === ruleSet.exceptionEventName)).toBe(
      true,
    );
  });

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

    expect(outcome.trace.map((entry) => entry.class)).toEqual(["broken", "confusing"]);
    expect(outcome.trace.every((entry) => entry.satisfied === false)).toBe(true);
  });

  test("should refuse to correlate against every name in passiveEventNames", () => {
    const ruleSet = ruleSetV1();

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

    expect(evaluate(result.candidates[0], ruleSet).kind).toBe("pass");
  });

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

    const candidate = result.candidates[0];
    if (candidate !== undefined) {
      const outcome = evaluate(candidate, ruleSet);

      if (outcome.kind === "pass") {
        expect(outcome.finalClass).not.toBe("broken");
      }
    }
  });

  test("should treat an unlisted event name as an ordinary action, so the denylist is data", () => {
    const ruleSet = ruleSetV1();
    const [passiveName] = ruleSet.passiveEventNames;

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

    expect(T1PSV_GAP_MS * 2).toBeLessThan(ruleSet.errorCorrelationWindowMs);

    const result = detectErrorEvent(t1psvCorpus(sessions), ruleSet);

    expect(result.candidates).toHaveLength(1);
    expect(correlatedSignalsOf(result)).toEqual([]);
    expect(uncorrelatedSignalsOf(result).length).toBe(ruleSet.errorMinAffectedSessions);
  });
});

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

    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0];
    expect(candidate.claimedClass).toBe("broken");

    expect(uncorrelatedSignalsOf(result).length).toBeGreaterThan(0);
    expect(correlatedSignalsOf(result)).toEqual([]);

    const outcome = evaluate(candidate, ruleSet);

    expect(outcome.kind).toBe("drop");

    expect(outcome.trace.map((entry) => entry.class)).toEqual(["broken", "confusing"]);
    expect(outcome.trace.every((entry) => entry.satisfied === false)).toBe(true);
    expect(outcome.trace.some((entry) => entry.class === "changed_mind")).toBe(false);

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

const T1CNT_SURFACE = "/t1cnt/settings";

const T1CNT_OTHER_SURFACE = "/t1cnt/billing";
const T1CNT_ACTION = "t1cnt_save_clicked";

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

    expect(corpus.basis.kept).toBe(affected + quiet);
    expect(affected).not.toBe(corpus.basis.kept);

    const candidate = candidateForSurface(detectErrorEvent(corpus, ruleSet), T1CNT_SURFACE);

    expect(candidate.counts).toHaveLength(1);

    const [count] = candidate.counts;

    expect(count.numerator).toBe(affected);
    expect(count.numerator).not.toBe(count.denominator);
    expect(count.numerator).not.toBe(corpus.basis.kept);

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

    expect(candidate.signals.length).toBe(affected * exceptionsPerSession);

    expect(candidate.counts).toHaveLength(1);
    expect(candidate.counts[0].numerator).toBe(affected);
    expect(candidate.counts[0].denominator).toBe(corpus.basis.kept);

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

    expect(first.counts).toHaveLength(1);
    expect(second.counts).toHaveLength(1);
    expect(first.counts[0].numerator).toBe(onSurface);
    expect(second.counts[0].numerator).toBe(onOtherSurface);
    expect(first.counts[0].numerator).not.toBe(second.counts[0].numerator);

    expect(first.counts[0].denominator).toBe(corpus.basis.kept);
    expect(second.counts[0].denominator).toBe(corpus.basis.kept);
    expect(corpus.basis.kept).toBe(onSurface + onOtherSurface);
  });
});
