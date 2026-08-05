import type { ConnectionState } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { measuredCount } from "../../src/counts/measured-count";
import type { CountBasis, MeasuredCount } from "../../src/counts/measured-count";
import type {
  AnalysisWindow,
  DetectorCandidate,
  DetectorCorpus,
  SessionTimeline,
} from "../../src/detect/types";
import { DOWNGRADE_PATH, evaluate } from "../../src/evidence/gate";
import type { DowngradeDestination, GateOutcome, ProposedClaim } from "../../src/evidence/gate";
import { changedMindProofSatisfied } from "../../src/evidence/predicates";
import type { EvidenceSignal } from "../../src/evidence/signals";
import type { ElementIdentity, SessionAction, SessionTranscript } from "../../src/replay/types";
import { THRESHOLD_RULE_SETS } from "../../src/rules/thresholds";
import { findingClassSchema } from "../../src/rules/types";
import type { FindingClass, ThresholdRuleSet } from "../../src/rules/types";

const WINDOW: AnalysisWindow = {
  start: new Date("2026-05-01T00:00:00.000Z"),
  end: new Date("2026-05-08T00:00:00.000Z"),
};

const SIGNAL_AT = new Date("2026-05-03T09:15:00.000Z");

const SURFACE = "/checkout/payment";

function ruleSetV1(): ThresholdRuleSet {
  const rules = THRESHOLD_RULE_SETS.get(1);
  if (!rules) throw new Error("rule set version 1 must remain resolvable forever");
  return rules;
}

const ALL_CLASSES: readonly FindingClass[] = findingClassSchema.options;

function claim(
  claimedClass: FindingClass,
  signals: readonly EvidenceSignal[],
  counts: readonly MeasuredCount[] = [],
): ProposedClaim {
  return {
    detector: "funnel_dropoff",
    claimedClass,
    surface: SURFACE,
    surfaceNormalisationVersion: 1,
    signals,
    counts,
    timeframe: WINDOW,
    coverage: { truncated: false, eventsWithoutUrlPath: 0 },
  };
}

function failureCorrelated(ruleSet: ThresholdRuleSet): EvidenceSignal {
  return {
    kind: "failure_correlated",
    eventName: ruleSet.exceptionEventName,
    occurredAt: SIGNAL_AT,
    precedingActionName: "submit_payment",
    correlationWindowMs: ruleSet.errorCorrelationWindowMs,

    correlatedSessions: measuredCount({
      numerator: 3,
      denominator: 10,
      unit: "sessions",
      timeframe: { start: new Date("2026-04-06"), end: new Date("2026-04-13") },
      basis: { totalInWindow: 10, kept: 10, setAside: [], keptUnchecked: 0 },
    }),
  };
}

function failureUncorrelated(ruleSet: ThresholdRuleSet): EvidenceSignal {
  return {
    kind: "failure_uncorrelated",
    eventName: ruleSet.exceptionEventName,
    occurredAt: SIGNAL_AT,
  };
}

const STRUGGLE_COHORT_KEPT = 40;

const STRUGGLING_SESSIONS_ABOVE_MINIMUM = 8;

function repeatedAttempt(
  attempts: number,
  strugglingSessions: number = STRUGGLING_SESSIONS_ABOVE_MINIMUM,
): EvidenceSignal {
  return {
    kind: "struggle",
    subkind: "repeated_attempt",
    surface: SURFACE,
    attempts,
    strugglingSessions: sessions(strugglingSessions, STRUGGLE_COHORT_KEPT),
  };
}

function backtrack(): EvidenceSignal {
  return {
    kind: "struggle",
    subkind: "backtrack",
    surface: SURFACE,
    attempts: 1,
    strugglingSessions: sessions(STRUGGLING_SESSIONS_ABOVE_MINIMUM, STRUGGLE_COHORT_KEPT),
  };
}

function cleanExit(): EvidenceSignal {
  return { kind: "clean_exit", surface: SURFACE };
}

function sessions(numerator: number, kept: number): MeasuredCount {
  return measuredCount({
    numerator,
    denominator: kept,
    unit: "sessions",
    timeframe: WINDOW,
    basis: { totalInWindow: kept, kept, keptUnchecked: 0, setAside: [] },
  });
}

function rateDrop(
  observedNumerator: number,
  expectedNumerator: number,
  denominator: number,
): EvidenceSignal {
  return {
    kind: "instrumentation_rate_drop",
    eventName: "checkout_completed",
    observed: sessions(observedNumerator, denominator),
    expected: sessions(expectedNumerator, denominator),
  };
}

function visitedClasses(outcome: GateOutcome): readonly FindingClass[] {
  return outcome.trace.map((entry) => entry.class);
}

describe("evidence gate — direct cells", () => {
  test("should pass broken when a failure signal is correlated to the action", () => {
    const ruleSet = ruleSetV1();

    const outcome = evaluate(claim("broken", [failureCorrelated(ruleSet)]), ruleSet);

    expect(outcome.kind).toBe("pass");
    if (outcome.kind !== "pass") throw new Error("unreachable — narrowing only");
    expect(outcome.finalClass).toBe("broken");

    expect(visitedClasses(outcome)).toEqual(["broken"]);
    expect(outcome.trace[0]?.satisfied).toBe(true);
  });

  test("should downgrade broken to confusing when no correlated failure signal exists", () => {
    const ruleSet = ruleSetV1();

    const outcome = evaluate(
      claim("broken", [
        failureUncorrelated(ruleSet),
        repeatedAttempt(ruleSet.struggleRepeatedAttemptMin),
      ]),
      ruleSet,
    );

    expect(outcome.kind).toBe("pass");
    if (outcome.kind !== "pass") throw new Error("unreachable — narrowing only");
    expect(outcome.finalClass).toBe("confusing");
    expect(visitedClasses(outcome)).toEqual(["broken", "confusing"]);
    expect(outcome.trace[0]?.satisfied).toBe(false);
    expect(outcome.trace[1]?.satisfied).toBe(true);
  });

  test("should pass confusing on repeated attempts, and NOT on a back-navigation alone", () => {
    const ruleSet = ruleSetV1();

    const repeated = evaluate(
      claim("confusing", [
        repeatedAttempt(ruleSet.struggleRepeatedAttemptMin, ruleSet.struggleMinStrugglingSessions),
      ]),
      ruleSet,
    );

    expect(repeated.kind).toBe("pass");
    if (repeated.kind !== "pass") throw new Error("unreachable — narrowing only");
    expect(repeated.finalClass).toBe("confusing");
    expect(visitedClasses(repeated)).toEqual(["confusing"]);

    const backtracked = evaluate(claim("confusing", [backtrack()]), ruleSet);

    expect(backtracked.kind).toBe("drop");
    expect(backtracked).not.toHaveProperty("finalClass");
    expect(visitedClasses(backtracked)).toEqual(["confusing"]);
    expect(backtracked.trace[0]?.satisfied).toBe(false);
    expect(JSON.stringify(backtracked)).not.toContain("changed_mind");

    const flattering = evaluate(claim("changed_mind", [cleanExit(), backtrack()]), ruleSet);
    expect(flattering.kind).toBe("drop");
  });

  test("should downgrade confusing when no struggle signal exists", () => {
    const ruleSet = ruleSetV1();

    const outcome = evaluate(claim("confusing", [cleanExit()]), ruleSet);

    expect(outcome.kind).toBe("drop");
    expect(outcome).not.toHaveProperty("finalClass");
    expect(visitedClasses(outcome)).toEqual(["confusing"]);
    expect(visitedClasses(outcome)).not.toContain("changed_mind");
  });

  test("should pass changed_mind when originally proposed with clean exit, no error, and no struggle signal", () => {
    const ruleSet = ruleSetV1();

    const outcome = evaluate(claim("changed_mind", [cleanExit()]), ruleSet);

    expect(outcome.kind).toBe("pass");
    if (outcome.kind !== "pass") throw new Error("unreachable — narrowing only");
    expect(outcome.finalClass).toBe("changed_mind");
    expect(visitedClasses(outcome)).toEqual(["changed_mind"]);
    expect(outcome.trace[0]?.satisfied).toBe(true);
  });

  test("should drop changed_mind when an error or struggle signal is present", () => {
    const ruleSet = ruleSetV1();

    const withCorrelatedError = evaluate(
      claim("changed_mind", [cleanExit(), failureCorrelated(ruleSet)]),
      ruleSet,
    );
    const withUncorrelatedError = evaluate(
      claim("changed_mind", [cleanExit(), failureUncorrelated(ruleSet)]),
      ruleSet,
    );
    const withStruggle = evaluate(claim("changed_mind", [cleanExit(), backtrack()]), ruleSet);

    for (const outcome of [withCorrelatedError, withUncorrelatedError, withStruggle]) {
      expect(outcome.kind).toBe("drop");
      expect(outcome).not.toHaveProperty("finalClass");
      expect(visitedClasses(outcome)).toEqual(["changed_mind"]);
      expect(outcome.trace[0]?.satisfied).toBe(false);
    }
  });

  test("should pass instrumentation when a known event's firing rate crosses its threshold", () => {
    const ruleSet = ruleSetV1();
    const denominator = 100;
    const expectedNumerator = ruleSet.instrumentationMinExpected * 2;

    const atThreshold = evaluate(
      claim("instrumentation", [
        rateDrop(
          (expectedNumerator * ruleSet.instrumentationDropRatioPercent) / 100,
          expectedNumerator,
          denominator,
        ),
      ]),
      ruleSet,
    );
    const wellBelowThreshold = evaluate(
      claim("instrumentation", [rateDrop(5, expectedNumerator, denominator)]),
      ruleSet,
    );

    for (const outcome of [atThreshold, wellBelowThreshold]) {
      expect(outcome.kind).toBe("pass");
      if (outcome.kind !== "pass") throw new Error("unreachable — narrowing only");
      expect(outcome.finalClass).toBe("instrumentation");
      expect(visitedClasses(outcome)).toEqual(["instrumentation"]);
    }
  });

  test("should drop instrumentation when the rate does not cross its threshold", () => {
    const ruleSet = ruleSetV1();
    const denominator = 100;
    const expectedNumerator = ruleSet.instrumentationMinExpected * 2;

    const justAboveThreshold = evaluate(
      claim("instrumentation", [
        rateDrop(
          (expectedNumerator * ruleSet.instrumentationDropRatioPercent) / 100 + 1,
          expectedNumerator,
          denominator,
        ),
      ]),
      ruleSet,
    );

    const baselineTooThin = evaluate(
      claim("instrumentation", [
        rateDrop(
          0,
          ruleSet.instrumentationMinExpected - 10,
          ruleSet.instrumentationMinExpected - 10,
        ),
      ]),
      ruleSet,
    );

    for (const outcome of [justAboveThreshold, baselineTooThin]) {
      expect(outcome.kind).toBe("drop");
      expect(outcome).not.toHaveProperty("finalClass");
      expect(visitedClasses(outcome)).toEqual(["instrumentation"]);
    }
  });
});

describe("evidence gate — cascade and floor", () => {
  test("THE INCIDENT TEST — should DROP a broken claim over a session with a clean single-click exit and no failure signal, never surface it as changed_mind", () => {
    const ruleSet = ruleSetV1();

    const outcome = evaluate(claim("broken", [cleanExit()]), ruleSet);

    expect(outcome.kind).toBe("drop");

    expect(outcome).not.toHaveProperty("finalClass");

    expect(visitedClasses(outcome)).toEqual(["broken", "confusing"]);
    expect(visitedClasses(outcome)).not.toContain("changed_mind");
    expect(outcome.trace.every((entry) => entry.satisfied === false)).toBe(true);

    expect(JSON.stringify(outcome)).not.toContain("changed_mind");
  });

  test("should cascade a broken claim with neither failure nor struggle signal past confusing to the floor and drop it", () => {
    const ruleSet = ruleSetV1();

    const outcome = evaluate(claim("broken", []), ruleSet);

    expect(outcome.kind).toBe("drop");
    expect(outcome).not.toHaveProperty("finalClass");
    expect(visitedClasses(outcome)).toEqual(["broken", "confusing"]);
    expect(outcome.trace.every((entry) => entry.satisfied === false)).toBe(true);

    expect(outcome.trace.length).toBeGreaterThanOrEqual(2);
  });

  test("should cascade a confusing claim with no struggle signal to the floor and drop it, regardless of a clean exit", () => {
    const ruleSet = ruleSetV1();

    const withCleanExit = evaluate(claim("confusing", [cleanExit()]), ruleSet);
    const withoutAnySignal = evaluate(claim("confusing", []), ruleSet);

    const withUncorrelatedError = evaluate(
      claim("confusing", [cleanExit(), failureUncorrelated(ruleSet)]),
      ruleSet,
    );

    for (const outcome of [withCleanExit, withoutAnySignal, withUncorrelatedError]) {
      expect(outcome.kind).toBe("drop");
      expect(outcome).not.toHaveProperty("finalClass");
      expect(visitedClasses(outcome)).toEqual(["confusing"]);
      expect(JSON.stringify(outcome)).not.toContain("changed_mind");
    }
  });

  test("should make changed_mind unreachable as a cascade destination from any starting class", () => {
    const destinations: readonly DowngradeDestination[] = Object.values(DOWNGRADE_PATH);
    expect(destinations).not.toContain("changed_mind");

    expect(new Set(Object.keys(DOWNGRADE_PATH))).toEqual(new Set(ALL_CLASSES));

    for (const start of ALL_CLASSES) {
      const reached: FindingClass[] = [];
      let current: DowngradeDestination = DOWNGRADE_PATH[start];
      while (current !== "drop") {
        expect(reached).not.toContain(current);
        expect(current).not.toBe("changed_mind");
        reached.push(current);
        current = DOWNGRADE_PATH[current];
      }
      expect(reached).not.toContain("changed_mind");
    }

    expect(DOWNGRADE_PATH.confusing).toBe("drop");
    expect(DOWNGRADE_PATH.broken).toBe("confusing");
    expect(DOWNGRADE_PATH.changed_mind).toBe("drop");
    expect(DOWNGRADE_PATH.instrumentation).toBe("drop");
  });
});

function descendantsOf(claimedClass: FindingClass): ReadonlySet<FindingClass> {
  const reachable = new Set<FindingClass>([claimedClass]);
  let current: DowngradeDestination = DOWNGRADE_PATH[claimedClass];
  while (current !== "drop" && !reachable.has(current)) {
    reachable.add(current);
    current = DOWNGRADE_PATH[current];
  }
  return reachable;
}

function powerSet<T>(items: readonly T[]): readonly (readonly T[])[] {
  let subsets: (readonly T[])[] = [[]];
  for (const item of items) {
    subsets = subsets.concat(subsets.map((subset) => [...subset, item]));
  }
  return subsets;
}

function everySignalKind(ruleSet: ThresholdRuleSet): readonly EvidenceSignal[] {
  return [
    failureCorrelated(ruleSet),
    failureUncorrelated(ruleSet),
    repeatedAttempt(ruleSet.struggleRepeatedAttemptMin),
    cleanExit(),
    rateDrop(0, ruleSet.instrumentationMinExpected * 2, 100),
  ];
}

describe("evidence gate — invariants", () => {
  test("should never return a class stronger than the one claimed", () => {
    const ruleSet = ruleSetV1();

    const tempted = evaluate(claim("confusing", [failureCorrelated(ruleSet)]), ruleSet);
    expect(visitedClasses(tempted)).not.toContain("broken");
    if (tempted.kind === "pass") expect(tempted.finalClass).not.toBe("broken");

    for (const claimedClass of ALL_CLASSES) {
      const allowed = descendantsOf(claimedClass);
      for (const signals of powerSet(everySignalKind(ruleSet))) {
        const outcome = evaluate(claim(claimedClass, signals), ruleSet);
        if (outcome.kind === "pass") {
          expect(allowed.has(outcome.finalClass)).toBe(true);
        }
        for (const entry of outcome.trace) {
          expect(allowed.has(entry.class)).toBe(true);
        }
      }
    }
  });

  test("should terminate the fixed-point descent for every starting class and every signal combination", () => {
    const ruleSet = ruleSetV1();

    let evaluated = 0;

    for (const claimedClass of ALL_CLASSES) {
      for (const signals of powerSet(everySignalKind(ruleSet))) {
        const outcome = evaluate(claim(claimedClass, signals), ruleSet);
        const visited = visitedClasses(outcome);
        evaluated += 1;

        expect(visited.length).toBeGreaterThanOrEqual(1);
        expect(visited.length).toBeLessThanOrEqual(ALL_CLASSES.length);

        expect(new Set(visited).size).toBe(visited.length);

        expect(visited[0]).toBe(claimedClass);
        for (let index = 1; index < visited.length; index += 1) {
          expect(DOWNGRADE_PATH[visited[index - 1] as FindingClass]).toBe(
            visited[index] as FindingClass,
          );
        }

        for (let index = 0; index < outcome.trace.length - 1; index += 1) {
          expect(outcome.trace[index]?.satisfied).toBe(false);
        }
        const last = outcome.trace[outcome.trace.length - 1];
        if (outcome.kind === "pass") {
          expect(last?.satisfied).toBe(true);
          expect(outcome.finalClass).toBe(last?.class as FindingClass);
        } else {
          expect(last?.satisfied).toBe(false);

          expect(DOWNGRADE_PATH[last?.class as FindingClass]).toBe("drop");
        }
      }
    }

    expect(evaluated).toBe(ALL_CLASSES.length * 2 ** 5);
  });

  test("should reject an unknown finding class at the Zod boundary, never default it to the weakest class", () => {
    const ruleSet = ruleSetV1();

    const unknownClass: unknown = { ...claim("broken", []), claimedClass: "user_error" };
    const missingClass: unknown = { ...claim("broken", []), claimedClass: undefined };

    for (const malformed of [unknownClass, missingClass]) {
      let thrown: unknown;
      let returned: GateOutcome | undefined;
      try {
        returned = evaluate(malformed, ruleSet);
      } catch (error) {
        thrown = error;
      }

      expect(returned).toBeUndefined();

      expect(thrown).toBeInstanceOf(z.ZodError);
      const issuePaths = (thrown as z.ZodError).issues.map((issue) => issue.path.join("."));
      expect(issuePaths).toContain("claimedClass");
    }
  });

  test("confusing is the floor — it downgrades to drop, never to another class", () => {
    expect(DOWNGRADE_PATH.confusing).toBe("drop");
    expect(Object.values(DOWNGRADE_PATH)).not.toContain("changed_mind");
  });
});

// TODO(O-041 T3.1/T3.3/T5.1): replace the local declarations, the ratified-value
// fallbacks and both deferred loads with static imports of SessionReplay,
// StruggleSubkind, struggleSubkindSchema and src/evidence/observed-struggle once they
// land. See .ai/adds/o-041-observed-struggle.md §9 and D-1.
const SRC_DIR = `${import.meta.dir}/../../src`.replaceAll("\\", "/");
const OBSERVED_STRUGGLE_SOURCE = `${SRC_DIR}/evidence/observed-struggle.ts`;
const SIGNALS_SOURCE = `${SRC_DIR}/evidence/signals.ts`;

type SessionReplay = {
  readonly sessionId: string;
  readonly transcript: SessionTranscript;
};

type ReplayCorpus = DetectorCorpus & {
  readonly replays?: readonly SessionReplay[];
};

type ObservedStruggleModule = {
  readonly observedStruggleCandidates: (
    corpus: ReplayCorpus,
    ruleSet: ThresholdRuleSet,
  ) => readonly DetectorCandidate[];
};

type StruggleSubkind =
  | "repeated_attempt"
  | "backtrack"
  | "rage_click"
  | "dead_click"
  | "field_abandoned"
  | "field_refocus"
  | "scroll_back";

const EVERY_DECLARED_STRUGGLE_SUBKIND: readonly StruggleSubkind[] = [
  "repeated_attempt",
  "backtrack",
  "rage_click",
  "dead_click",
  "field_abandoned",
  "field_refocus",
  "scroll_back",
];

type SignalsModule = {
  readonly struggleSubkindSchema: { readonly options: readonly StruggleSubkind[] };
};

async function declaredStruggleSubkinds(): Promise<readonly StruggleSubkind[]> {
  const loaded = (await import(SIGNALS_SOURCE)) as Partial<SignalsModule>;
  const options = loaded.struggleSubkindSchema?.options;

  if (options === undefined) {
    throw new Error(
      "src/evidence/signals.ts must export struggleSubkindSchema — the one declaration of the struggle subkind union (D-7)",
    );
  }

  return options;
}

async function observedStruggleCandidates(
  corpus: ReplayCorpus,
  ruleSet: ThresholdRuleSet,
): Promise<readonly DetectorCandidate[]> {
  const loaded = (await import(OBSERVED_STRUGGLE_SOURCE)) as Partial<ObservedStruggleModule>;

  if (typeof loaded.observedStruggleCandidates !== "function") {
    throw new Error(
      "src/evidence/observed-struggle.ts must export observedStruggleCandidates(corpus, ruleSet)",
    );
  }

  return loaded.observedStruggleCandidates(corpus, ruleSet);
}

async function signalsFrom(
  corpus: ReplayCorpus,
  ruleSet: ThresholdRuleSet,
): Promise<readonly EvidenceSignal[]> {
  const candidates = await observedStruggleCandidates(corpus, ruleSet);
  return candidates.flatMap((candidate) => [...candidate.signals]);
}

// TODO(O-041 D-9): both members land on ThresholdRuleSet in the rules wave; the ADD §4
// ratified values below are the fallback until they do, and become unreachable after.
type ObservedThresholdMembers = {
  readonly struggleRageClickMin?: number;
  readonly struggleObservedMinSessions?: number;
};

const RATIFIED_RAGE_CLICK_MIN = 4;
const RATIFIED_OBSERVED_MIN_SESSIONS = 5;

function observedFloors(ruleSet: ThresholdRuleSet): {
  readonly rageClickMin: number;
  readonly minSessions: number;
} {
  const declared: ThresholdRuleSet & ObservedThresholdMembers = ruleSet;

  return {
    rageClickMin: declared.struggleRageClickMin ?? RATIFIED_RAGE_CLICK_MIN,
    minSessions: declared.struggleObservedMinSessions ?? RATIFIED_OBSERVED_MIN_SESSIONS,
  };
}

const O041_PROJECT_ID = "t041-gate-project";
const O041_SURFACE = "/t041-gate/checkout";
const O041_HREF = `https://t041-gate.example.invalid${O041_SURFACE}`;

const O041_ACTION_STRIDE_MS = 1_000;
const O041_RAGE_SPAN_MS = 900;
const O041_SESSION_STRIDE_MS = 60_000;
const O041_FIRST_SESSION_AT = new Date("2026-05-02T09:00:00.000Z");

const O041_PAY_CONTROL: ElementIdentity = {
  nodeId: 4_101,
  tagName: "button",
  classes: [],
  attributes: {},
  testId: "t041-gate-pay",
};

const O041_CONNECTION_STATE: ConnectionState = {
  status: "connected_receiving",
  connection: {
    id: "t041-gate-connection",
    organizationId: "t041-gate-org",
    projectId: O041_PROJECT_ID,
    sourceKind: "posthog",
    host: "https://t041-gate.example.invalid",
    sourceProjectId: "t041-gate-source-project",
    isActive: true,
    health: "healthy",
    healthReasonCode: null,
    healthReasonMessage: null,
    healthCheckedAt: WINDOW.end,
    watermarkAt: WINDOW.end,
    backfillBefore: null,
    pollIntervalSeconds: 60,
    connectedAt: WINDOW.start,
    inferredInternalDomain: null,
    internalDomainProvenance: null,
  },
};

function o041Transcript(clicks: number): SessionTranscript {
  const actions: readonly SessionAction[] = [
    { kind: "page", atMs: 0, href: O041_HREF },
    {
      kind: "rage_click",
      atMs: O041_ACTION_STRIDE_MS,
      element: O041_PAY_CONTROL,
      clicks,
      spanMs: O041_RAGE_SPAN_MS,
    },
  ];

  return {
    actions,
    startedAt: O041_FIRST_SESSION_AT,
    durationMs: actions.length * O041_ACTION_STRIDE_MS,
    pages: [O041_HREF],
    counts: {
      clicks: 0,
      deadClicks: 0,
      rageClicks: 1,
      refocuses: 0,
      abandonedFields: 0,
      scrollBacks: 0,
    },
    droppedEvents: 0,
  };
}

function o041SessionId(slot: number): string {
  return `t041-gate-session-${String(slot).padStart(2, "0")}`;
}

function o041Timeline(slot: number): SessionTimeline {
  return {
    sessionId: o041SessionId(slot),
    startedAt: new Date(O041_FIRST_SESSION_AT.getTime() + slot * O041_SESSION_STRIDE_MS),
    exclusionReason: "none",
    entryUrlPath: O041_SURFACE,
    events: [],
  };
}

function o041Basis(kept: number): CountBasis {
  return { totalInWindow: kept, kept, setAside: [], keptUnchecked: 0 };
}

function o041Corpus(clicksPerSession: number, ruleSet: ThresholdRuleSet): ReplayCorpus {
  const { minSessions } = observedFloors(ruleSet);
  const slots: readonly number[] = Array.from({ length: minSessions }, (_unused, slot) => slot);

  return {
    projectId: O041_PROJECT_ID,
    window: WINDOW,
    connectionState: O041_CONNECTION_STATE,
    sessions: slots.map(o041Timeline),
    basis: o041Basis(minSessions),
    coverage: { truncated: false, eventsWithoutUrlPath: 0 },
    replays: slots.map((slot) => ({
      sessionId: o041SessionId(slot),
      transcript: o041Transcript(clicksPerSession),
    })),
  };
}

function belowThresholdCorpus(ruleSet: ThresholdRuleSet): ReplayCorpus {
  return o041Corpus(observedFloors(ruleSet).rageClickMin - 1, ruleSet);
}

function clearingCorpus(ruleSet: ThresholdRuleSet): ReplayCorpus {
  return o041Corpus(observedFloors(ruleSet).rageClickMin, ruleSet);
}

async function rageClickClear(ruleSet: ThresholdRuleSet): Promise<EvidenceSignal> {
  const signals = await signalsFrom(clearingCorpus(ruleSet), ruleSet);

  if (signals.length !== 1) {
    throw new Error(
      `a corpus clearing struggleRageClickMin over struggleObservedMinSessions emits one struggle signal, not ${String(signals.length)}`,
    );
  }

  return signals[0];
}

// Widened: EvidenceSignal's struggle arm carries only the two inferred subkinds until
// D-7 makes StruggleSubkind its one declaration.
function struggleOfSubkind(
  subkind: StruggleSubkind,
  attempts: number,
  strugglingSessions: number,
): EvidenceSignal {
  return {
    kind: "struggle",
    subkind,
    surface: SURFACE,
    attempts,
    strugglingSessions: sessions(strugglingSessions, STRUGGLE_COHORT_KEPT),
  } as EvidenceSignal;
}

const FAR_ABOVE_ANY_MAGNITUDE = 1_000;

function everyMagnitude(
  ruleSet: ThresholdRuleSet,
): readonly { readonly attempts: number; readonly strugglingSessions: number }[] {
  return [
    { attempts: 1, strugglingSessions: 1 },
    {
      attempts: ruleSet.struggleRepeatedAttemptMin,
      strugglingSessions: ruleSet.struggleMinStrugglingSessions,
    },
    { attempts: FAR_ABOVE_ANY_MAGNITUDE, strugglingSessions: STRUGGLE_COHORT_KEPT },
  ];
}

const PRE_SPRINT_CONFUSING_DROP_TRACE_LENGTH = 1;

describe("evidence gate — O-041 grade-unchanged regressions", () => {
  test("should not drop changed_mind when an observed beat falls below its threshold", async () => {
    const ruleSet = ruleSetV1();

    const candidates = await observedStruggleCandidates(belowThresholdCorpus(ruleSet), ruleSet);
    const signalsFromThoseCandidates = candidates.flatMap((candidate) => [...candidate.signals]);

    expect(candidates).toEqual([]);
    expect(changedMindProofSatisfied([cleanExit(), ...signalsFromThoseCandidates], ruleSet)).toBe(
      changedMindProofSatisfied([cleanExit()], ruleSet),
    );
    expect(changedMindProofSatisfied([cleanExit(), ...signalsFromThoseCandidates], ruleSet)).toBe(
      true,
    );
  });

  test("should not change the confusing verdict when an observed beat falls below its threshold", async () => {
    const ruleSet = ruleSetV1();
    const subThreshold = repeatedAttempt(ruleSet.struggleRepeatedAttemptMin - 1);

    const preSprint = evaluate(claim("confusing", [subThreshold]), ruleSet);
    const withObservedBeat = evaluate(
      claim("confusing", [
        subThreshold,
        ...(await signalsFrom(belowThresholdCorpus(ruleSet), ruleSet)),
      ]),
      ruleSet,
    );

    expect(preSprint.kind).toBe("drop");
    expect(preSprint.trace.length).toBe(PRE_SPRINT_CONFUSING_DROP_TRACE_LENGTH);
    expect(withObservedBeat.kind).toBe("drop");
    expect(withObservedBeat.trace.length).toBe(PRE_SPRINT_CONFUSING_DROP_TRACE_LENGTH);
    expect(visitedClasses(withObservedBeat)).toEqual(visitedClasses(preSprint));
  });

  test("should drop changed_mind when an observed struggle signal clears its threshold", async () => {
    const ruleSet = ruleSetV1();

    expect(changedMindProofSatisfied([cleanExit(), await rageClickClear(ruleSet)], ruleSet)).toBe(
      false,
    );
  });

  test("should not edit CHANGED_MIND_DISQUALIFYING_KINDS", async () => {
    const ruleSet = ruleSetV1();
    const subkinds = await declaredStruggleSubkinds();

    expect(new Set(subkinds)).toEqual(new Set(EVERY_DECLARED_STRUGGLE_SUBKIND));

    for (const subkind of subkinds) {
      for (const magnitude of everyMagnitude(ruleSet)) {
        const signal = struggleOfSubkind(subkind, magnitude.attempts, magnitude.strugglingSessions);

        expect(changedMindProofSatisfied([cleanExit(), signal], ruleSet)).toBe(false);
      }
    }
  });
});
