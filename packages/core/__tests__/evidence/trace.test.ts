// Unit tests for downgrade provenance: the four named tests for the trace.
//
// The design point these tests encode: the machine-readable identifiers (`class`,
// `predicate`, `predicateVersion`, `satisfied`, `reasonCode`) travel on the trace entry
// beside the plain-English sentence. Both, separately. Test 3 asserts the sentence
// carries none of them. The target register, from the add:
//
// "We saw people struggling here, but we could not prove the save itself
//  failed."
//
// Never: "broken -> confusing: predicate failure_correlated_v1 unsatisfied."
//
// No clock and no randomness in this file: every instant is a fixture constant passed
// in as a parameter. `Date.now` appears nowhere.
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

// Fixtures. Time is a required parameter, never a clock read.

/** The analysis window every claim below is measured over. Frozen. */
const WINDOW = {
  start: new Date("2026-07-01T00:00:00.000Z"),
  end: new Date("2026-07-08T00:00:00.000Z"),
} as const;

/** When the fixture exception happened. Inside `WINDOW`, and fixed. */
const FAILURE_AT = new Date("2026-07-03T09:15:00.000Z");

const SURFACE = "/settings/profile";

/** The v1 rule set fetched by version, never "whatever is current". */
function ruleSetV1(): ThresholdRuleSet {
  const rules = THRESHOLD_RULE_SETS.get(1);
  if (!rules) throw new Error("rule set version 1 must remain resolvable forever");
  return rules;
}

/**
 * A claim the gate can evaluate. `counts: []` deliberately, a trace is provenance about
 * predicates, and nothing in this file depends on a magnitude.
 */
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

/**
 * A struggle signal above both of `confusing`'s magnitudes: four visits by one session
 * (`struggleRepeatedAttemptMin` is 3 at v1) made by six sessions
 * (`struggleMinStrugglingSessions` is 3). Both are required for the `confusing` rung to
 * hold, and this file needs it to hold. The trace it asserts on is the one produced by
 * a downgrade that lands.
 */
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

/** The one signal kind that proves `broken` at v1. */
const CORRELATED_FAILURE: EvidenceSignal = {
  kind: "failure_correlated",
  eventName: "$exception",
  occurredAt: FAILURE_AT,
  precedingActionName: "save_profile",
  correlationWindowMs: 30_000,
  // The proven cohort, required since audit C-1: `broken` may not pass on a single
  // correlated session while its count reports a larger population.
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
    // A `broken` claim with struggle but NO correlated failure: rung one fails, rung
    // two holds. Two rungs evaluated, two entries recorded.
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

    // The unsatisfied rung, named. Predicate and version, so a v2 predicate's verdict
    // is never read as a v1 one.
    expect(downgraded.trace[0]).toEqual({
      class: "broken",
      predicate: "broken_failure_correlated",
      predicateVersion: PROOF_PREDICATE_VERSION,
      satisfied: false,
      reasonCode: "broken_unsatisfied",
      reason: GATE_REASON_MESSAGES.broken_unsatisfied,
    });
    // The name on the trace is the predicate registry's own name, not a second copy
    // that can drift from it.
    expect(downgraded.trace[0]?.predicate).toBe(PROOF_PREDICATES.broken.name);
    expect(downgraded.trace[0]?.predicateVersion).toBe(PROOF_PREDICATES.broken.version);

    // The rung it descended TO is recorded as well. A trace that stopped at the failure
    // would not say where the claim ended up.
    expect(downgraded.trace[1]).toEqual({
      class: "confusing",
      predicate: "confusing_struggle",
      predicateVersion: PROOF_PREDICATE_VERSION,
      satisfied: true,
      reasonCode: "confusing_satisfied",
      reason: GATE_REASON_MESSAGES.confusing_satisfied,
    });
    expect(passOf(downgraded).finalClass).toBe("confusing");

    // A claim that cascades all the way to the floor still carries the full descent. A
    // drop is the outcome most in need of provenance, because nothing else about it
    // ever reaches a customer.
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

  // . Easy to forget, and the whole point: a trace that exists only on downgrades
  // means every passing finding ships with no provenance at all. "we checked and it
  // held" would then be indistinguishable from "we did not check".
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

    // Not empty. One rung was evaluated, so one entry is recorded.
    expect(passed.trace).toHaveLength(1);
    expect(passed.trace[0]).toEqual({
      class: "broken",
      predicate: "broken_failure_correlated",
      predicateVersion: PROOF_PREDICATE_VERSION,
      satisfied: true,
      reasonCode: "broken_satisfied",
      reason: GATE_REASON_MESSAGES.broken_satisfied,
    });

    // The same holds one rung down: a claim that passes after a downgrade records the
    // satisfied entry too, not just the failure that got it there.
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
    // Every fixed reason string, scanned totally rather than sampled. A ninth message
    // added without a sentence to match would otherwise escape.
    const everyReason = Object.values(GATE_REASON_MESSAGES);
    expect(everyReason).toHaveLength(8);
    for (const reason of everyReason) {
      expect(machineIdentifiersIn(reason)).toEqual([]);
    }

    // Non-vacuity. The scanner must actually catch the register the add forbids, or the
    // eight assertions above prove nothing.
    expect(
      machineIdentifiersIn("broken -> confusing: predicate failure_correlated_v1 unsatisfied."),
    ).not.toEqual([]);

    // The builder puts both channels on one entry: the identifiers a machine reads, and
    // the sentence a founder reads, side by side and separate.
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

    // And the gate never invents a sentence of its own beside the table. Every reason
    // it emits IS the registered one for its code.
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

  // The registration is what makes the already-hostile plain-English suite at
  // `packages/shared/__tests__/session-source/messages.test.ts` cover these strings for
  // free. Enforced by a test the agent that wrote the strings did not write.
  //
  // Written against the post-move destination per: Wave 4 relocates
  // `GATE_REASON_MESSAGES` to `packages/shared/src/gate/messages.ts`, re-exports it so
  // `shared`'s export-derived completeness scan sees it, spreads it into
  // `ALL_CUSTOMER_FACING_MESSAGES`, and imports it back into `core`. Arrow stays core
  // -> shared, no cycle.
  test("should register every gate reason string in ALL_CUSTOMER_FACING_MESSAGES", () => {
    const registered = new Set(ALL_CUSTOMER_FACING_MESSAGES);

    // Non-vacuity on both sides: eight reasons, and a non-empty registry.
    expect(Object.keys(GATE_REASON_MESSAGES)).toHaveLength(8);
    expect(ALL_CUSTOMER_FACING_MESSAGES.length).toBeGreaterThan(0);

    const unregistered = Object.entries(GATE_REASON_MESSAGES)
      .filter(([, reason]) => !registered.has(reason))
      .map(([code]) => code);

    expect(unregistered).toEqual([]);
  });

  // The contradictory-trace regression (product decisions)
  //
  // Fail direction: a sentence that asserts more than the predicate proved.
  //
  // A reason string is keyed by class alone, so it is emitted for every reason that
  // rung's proof failed. An `_unsatisfied` sentence may therefore only say that proof
  // was sought and not found. When one asserted a positive observation instead, the
  // gate emitted two contradictory sentences in a single trace and the first was FALSE.
  // See the comment above `GATE_REASON_MESSAGES` in
  // `packages/shared/src/gate/messages.ts`.
  //
  // The jargon suites in `shared` audit whether these sentences are readable. Nothing
  // audited whether they are TRUE. This does.
  test("should state only the absence of proof in every unsatisfied reason, never a positive observation", () => {
    // Phrasings that assert something was observed. Each one is only utterable by a
    // rung that knows why its proof failed, and no rung does.
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

    // Non-vacuity, both directions. Four unsatisfied keys must exist, and the pattern
    // list must actually fire on the exact sentence that shipped. Otherwise this passes
    // by matching nothing.
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

    // And each one must carry an explicit absence marker, so "we are not claiming this"
    // is stated rather than merely implied by omission.
    const withoutAbsenceMarker = unsatisfied
      .filter(([, reason]) => !/\bcould not\b/i.test(reason))
      .map(([code]) => code);

    expect(withoutAbsenceMarker).toEqual([]);
  });
});

// The scanner

/**
 * Every machine-readable token that must not appear in a sentence shown to a founder.
 * Derived from the real registries wherever one exists, so a renamed predicate or a
 * fifth finding class updates this scan automatically rather than leaving a stale
 * hand-list behind.
 */
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
    // Product jargon and internal vocabulary.
    //
    // NOTE what is deliberately absent, and do not "complete" this list without
    // re-reading this (— an exclusion predicate that fires on a superset of its
    // target):
    // "event" and "rate" are words a founder uses about their own
    //  product, and the instrumentation messages use them correctly;
    // "claim" is not here. `ProposedClaim` is an internal type, but "we
    //  are not making a claim about it" is ordinary English a founder
    //  reads without friction. Banning it would fail this audit on a
    //  lexical collision with a type name rather than on a jargon leak,
    //  and would push the rewording in the wrong direction — toward a
    //  vaguer sentence, to satisfy a test.
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

/** Which forbidden tokens a sentence contains. Empty is the passing shape. */
function machineIdentifiersIn(sentence: string): string[] {
  const found: string[] = [];
  for (const token of forbiddenTokens()) {
    // Word-boundary, so "classify" would be fine and "class" is not. An underscore is a
    // word character in JS, so `\bbroken\b` correctly does not match inside
    // `broken_unsatisfied`, which is why the reason codes are scanned as tokens in
    // their own right above.
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(sentence)) {
      found.push(token);
    }
  }
  return found;
}
