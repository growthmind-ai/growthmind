import { ALL_CUSTOMER_FACING_MESSAGES } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { measuredCount } from "../../src/counts/measured-count";
import { evaluate } from "../../src/evidence/gate";
import type { GateOutcome, ProposedClaim } from "../../src/evidence/gate";
import { PROOF_PREDICATES, PROOF_PREDICATE_VERSION } from "../../src/evidence/predicates";
import type { EvidenceSignal } from "../../src/evidence/signals";
import { GATE_REASON_MESSAGES, traceEntry } from "../../src/evidence/trace";
import { THRESHOLD_RULE_SETS } from "../../src/rules/thresholds";
import type { FindingClass, ThresholdRuleSet } from "../../src/rules/types";

const WINDOW = {
  start: new Date("2026-07-01T00:00:00.000Z"),
  end: new Date("2026-07-08T00:00:00.000Z"),
} as const;

const FAILURE_AT = new Date("2026-07-03T09:15:00.000Z");

const SURFACE = "/settings/profile";

function ruleSetV1(): ThresholdRuleSet {
  const rules = THRESHOLD_RULE_SETS.get(1);
  if (!rules) throw new Error("rule set version 1 must remain resolvable forever");
  return rules;
}

function claim(input: {
  readonly claimedClass: FindingClass;
  readonly signals: readonly EvidenceSignal[];
  readonly timeframe: { readonly start: Date; readonly end: Date };
}): ProposedClaim {
  return {
    detector: "error_event",
    claimedClass: input.claimedClass,
    surface: SURFACE,
    surfaceNormalisationVersion: 1,
    signals: input.signals,
    counts: [],
    timeframe: input.timeframe,
    coverage: { truncated: false, eventsWithoutUrlPath: 0 },
  };
}

const REPEATED_ATTEMPTS: EvidenceSignal = {
  kind: "struggle",
  subkind: "repeated_attempt",
  surface: SURFACE,
  attempts: 4,
  strugglingSessions: measuredCount({
    numerator: 6,
    denominator: 30,
    unit: "sessions",
    timeframe: { start: WINDOW.start, end: WINDOW.end },
    basis: { totalInWindow: 30, kept: 30, setAside: [] },
  }),
};

const CORRELATED_FAILURE: EvidenceSignal = {
  kind: "failure_correlated",
  eventName: "$exception",
  occurredAt: FAILURE_AT,
  precedingActionName: "save_profile",
  correlationWindowMs: 30_000,

  correlatedSessions: measuredCount({
    numerator: 3,
    denominator: 10,
    unit: "sessions",
    timeframe: { start: new Date("2026-04-06"), end: new Date("2026-04-13") },
    basis: { totalInWindow: 10, kept: 10, setAside: [] },
  }),
};

function passOf(outcome: GateOutcome): Extract<GateOutcome, { kind: "pass" }> {
  if (outcome.kind !== "pass") {
    throw new Error(`expected a pass, got ${outcome.kind}`);
  }
  return outcome;
}

describe("the downgrade trace", () => {
  test("should carry a trace of length >= 2 naming the unsatisfied predicate and its version on a downgrade", () => {
    const downgraded = evaluate(
      claim({
        claimedClass: "broken",
        signals: [REPEATED_ATTEMPTS],
        timeframe: WINDOW,
      }),
      ruleSetV1(),
    );

    expect(downgraded.trace.length).toBeGreaterThanOrEqual(2);
    expect(downgraded.trace).toHaveLength(2);

    expect(downgraded.trace[0]).toEqual({
      class: "broken",
      predicate: "broken_failure_correlated",
      predicateVersion: PROOF_PREDICATE_VERSION,
      satisfied: false,
      reasonCode: "broken_unsatisfied",
      reason: GATE_REASON_MESSAGES.broken_unsatisfied,
    });

    expect(downgraded.trace[0]?.predicate).toBe(PROOF_PREDICATES.broken.name);
    expect(downgraded.trace[0]?.predicateVersion).toBe(PROOF_PREDICATES.broken.version);

    expect(downgraded.trace[1]).toEqual({
      class: "confusing",
      predicate: "confusing_struggle",
      predicateVersion: PROOF_PREDICATE_VERSION,
      satisfied: true,
      reasonCode: "confusing_satisfied",
      reason: GATE_REASON_MESSAGES.confusing_satisfied,
    });
    expect(passOf(downgraded).finalClass).toBe("confusing");

    const dropped = evaluate(
      claim({ claimedClass: "broken", signals: [], timeframe: WINDOW }),
      ruleSetV1(),
    );

    expect(dropped.kind).toBe("drop");
    expect(dropped.trace.length).toBeGreaterThanOrEqual(2);
    expect(dropped.trace.map((entry) => entry.class)).toEqual(["broken", "confusing"]);
    expect(dropped.trace.every((entry) => entry.satisfied === false)).toBe(true);
    expect(dropped.trace.map((entry) => entry.predicateVersion)).toEqual([
      PROOF_PREDICATE_VERSION,
      PROOF_PREDICATE_VERSION,
    ]);
  });

  test("should carry the satisfied predicate's trace entry on a PASSING claim", () => {
    const passed = evaluate(
      claim({
        claimedClass: "broken",
        signals: [CORRELATED_FAILURE],
        timeframe: WINDOW,
      }),
      ruleSetV1(),
    );

    expect(passOf(passed).finalClass).toBe("broken");

    expect(passed.trace).toHaveLength(1);
    expect(passed.trace[0]).toEqual({
      class: "broken",
      predicate: "broken_failure_correlated",
      predicateVersion: PROOF_PREDICATE_VERSION,
      satisfied: true,
      reasonCode: "broken_satisfied",
      reason: GATE_REASON_MESSAGES.broken_satisfied,
    });

    const passedAfterDowngrade = evaluate(
      claim({ claimedClass: "broken", signals: [REPEATED_ATTEMPTS], timeframe: WINDOW }),
      ruleSetV1(),
    );
    const satisfiedEntries = passedAfterDowngrade.trace.filter((entry) => entry.satisfied);
    expect(satisfiedEntries).toHaveLength(1);
    expect(satisfiedEntries[0]?.class).toBe("confusing");
    expect(satisfiedEntries[0]?.reasonCode).toBe("confusing_satisfied");
  });

  test("should carry a plain-English reason with no class name, predicate identifier, or product jargon", () => {
    const everyReason = Object.values(GATE_REASON_MESSAGES);
    expect(everyReason).toHaveLength(8);
    for (const reason of everyReason) {
      expect(machineIdentifiersIn(reason)).toEqual([]);
    }

    expect(
      machineIdentifiersIn("broken -> confusing: predicate failure_correlated_v1 unsatisfied."),
    ).not.toEqual([]);

    const built = traceEntry({
      class: "broken",
      predicate: PROOF_PREDICATES.broken.name,
      predicateVersion: PROOF_PREDICATE_VERSION,
      satisfied: false,
    });
    expect(built.class).toBe("broken");
    expect(built.predicate).toBe("broken_failure_correlated");
    expect(built.predicateVersion).toBe(PROOF_PREDICATE_VERSION);
    expect(built.satisfied).toBe(false);
    expect(built.reasonCode).toBe("broken_unsatisfied");
    expect(built.reason).toBe(GATE_REASON_MESSAGES.broken_unsatisfied);
    expect(machineIdentifiersIn(built.reason)).toEqual([]);

    const outcomes = [
      evaluate(
        claim({ claimedClass: "broken", signals: [CORRELATED_FAILURE], timeframe: WINDOW }),
        ruleSetV1(),
      ),
      evaluate(
        claim({ claimedClass: "broken", signals: [REPEATED_ATTEMPTS], timeframe: WINDOW }),
        ruleSetV1(),
      ),
      evaluate(claim({ claimedClass: "broken", signals: [], timeframe: WINDOW }), ruleSetV1()),
      evaluate(
        claim({
          claimedClass: "changed_mind",
          signals: [{ kind: "clean_exit", surface: SURFACE }],
          timeframe: WINDOW,
        }),
        ruleSetV1(),
      ),
    ];

    const emitted = outcomes.flatMap((outcome) => outcome.trace);
    expect(emitted.length).toBeGreaterThan(0);
    for (const entry of emitted) {
      expect(entry.reason).toBe(GATE_REASON_MESSAGES[entry.reasonCode]);
      expect(machineIdentifiersIn(entry.reason)).toEqual([]);
    }
  });

  test("should register every gate reason string in ALL_CUSTOMER_FACING_MESSAGES", () => {
    const registered = new Set(ALL_CUSTOMER_FACING_MESSAGES);

    expect(Object.keys(GATE_REASON_MESSAGES)).toHaveLength(8);
    expect(ALL_CUSTOMER_FACING_MESSAGES.length).toBeGreaterThan(0);

    const unregistered = Object.entries(GATE_REASON_MESSAGES)
      .filter(([, reason]) => !registered.has(reason))
      .map(([code]) => code);

    expect(unregistered).toEqual([]);
  });

  test("should state only the absence of proof in every unsatisfied reason, never a positive observation", () => {
    const positiveAssertions = [
      /\bwe saw\b/i,
      /\bsomething went wrong\b/i,
      /\bpeople struggled\b/i,
      /\bis still\b/i,
      /\bare still\b/i,
    ];

    const unsatisfied = Object.entries(GATE_REASON_MESSAGES).filter(([code]) =>
      code.endsWith("_unsatisfied"),
    );

    expect(unsatisfied).toHaveLength(4);
    expect(
      positiveAssertions.some((pattern) =>
        pattern.test(
          "We saw people struggling here, but we could not prove the save itself failed.",
        ),
      ),
    ).toBe(true);

    const offenders = unsatisfied
      .filter(([, reason]) => positiveAssertions.some((pattern) => pattern.test(reason)))
      .map(([code, reason]) => `${code}: ${reason}`);

    expect(offenders).toEqual([]);

    const withoutAbsenceMarker = unsatisfied
      .filter(([, reason]) => !/\bcould not\b/i.test(reason))
      .map(([code]) => code);

    expect(withoutAbsenceMarker).toEqual([]);
  });
});

function forbiddenTokens(): readonly string[] {
  const classNames: readonly FindingClass[] = [
    "broken",
    "confusing",
    "changed_mind",
    "instrumentation",
  ];

  return [
    ...classNames,
    "changed mind",
    ...Object.values(PROOF_PREDICATES).map((predicate) => predicate.name),
    ...Object.keys(GATE_REASON_MESSAGES),

    "predicate",
    "downgrade",
    "downgraded",
    "trace",
    "gate",
    "detector",
    "signal",
    "threshold",
    "ruleset",
    "rule set",
    "unsatisfied",
    "satisfied",
    "evidence",
    "class",
    "corpus",
    "schema",
    "boolean",
    "null",
    "undefined",
  ];
}

function machineIdentifiersIn(sentence: string): string[] {
  const found: string[] = [];
  for (const token of forbiddenTokens()) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(sentence)) {
      found.push(token);
    }
  }
  return found;
}
