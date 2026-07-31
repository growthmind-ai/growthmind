// ADD §7 "Unit — the gate, one test per D-3 cell" — the sixteen named tests,
// verbatim as named (O-004 FR-12, FR-13, FR-13B, D-9, D-10, ES-12).
//
// THIS IS THE PRODUCT'S IDENTITY, NOT A FEATURE. mvp.md §4: "a summary without
// deterministic proof predicates is an AI narrating a session, which §6 exists
// to prevent."
//
// The contract these tests pin:
//   1. Eight DIRECT cells — one per cell of architecture D-3's table: each
//      class passes when its own proof predicate holds, and takes its
//      `DOWNGRADE_PATH` destination when it does not.
//   2. The CASCADE and the FLOOR — a failed proof descends along
//      `DOWNGRADE_PATH` and terminates at `"drop"`. `changed_mind` is
//      unreachable as a cascade DESTINATION (FR-13B), asserted over the map's
//      VALUES rather than through behaviour, because a behavioural assertion
//      here can pass vacuously and a direct one cannot (D-10).
//   3. The GATE INVARIANTS — never ascend, always terminate, reject an unknown
//      class at the Zod boundary (ES-12), and keep the FR-13B rationale
//      physically present at the floor's implementation site.
//
// WHY 9, 12 AND 16 EXIST. `changed_mind`'s proof predicate is "clean exit, no
// error, no struggle" — satisfied by the ABSENCE OF EVERYTHING. BS-1(a)'s
// silent no-op save (the MVP's own headline demo case, ESC-1) is undetectable
// over the current `events` schema and therefore produces exactly that
// absence. If the ladder let a failed `confusing` descend to `changed_mind`,
// the product would tell a founder "this user changed their mind" when the
// product BROKE UNDER THEM — the §6 violation this whole sprint exists to
// prevent. Test 9 is that incident, replayed. Test 12 is the structural
// guarantee it cannot recur. Test 16 guards the comment that stops a future
// contributor "fixing" the apparent gap in the ordering.
//
// FIXTURE TIME IS A REQUIRED PARAMETER (ADD §6.5). Every instant below is a
// frozen literal; there is no `Date.now()`, no clock, and no randomness in
// this file. There is also no node builtin — the source read in test 16 goes
// through `Bun.file`, keeping this package's "no node builtin" discipline
// (FR-5, D-13) true in the tests as well as in `src/`.
//
// LANE ISOLATION (ADD §6.5) does not apply here: this suite touches no
// database, seeds no rows, and shares no fixture namespace with any other
// suite. Stated so its absence reads as a decision rather than an omission.
//
// The rule set arrives BY VERSION (`THRESHOLD_RULE_SETS.get(1)`), never as
// "whatever is current" (D-14). PL ruling 3: there is no clock parameter.
// PL ruling 1: thresholds are INTEGER PERCENTAGES compared with exact integer
// arithmetic.
import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { measuredCount } from "../../src/counts/measured-count";
import type { MeasuredCount } from "../../src/counts/measured-count";
import type { AnalysisWindow } from "../../src/detect/types";
import { DOWNGRADE_PATH, evaluate } from "../../src/evidence/gate";
import type { DowngradeDestination, GateOutcome, ProposedClaim } from "../../src/evidence/gate";
import type { EvidenceSignal } from "../../src/evidence/signals";
import { THRESHOLD_RULE_SETS } from "../../src/rules/thresholds";
import { findingClassSchema } from "../../src/rules/types";
import type { FindingClass, ThresholdRuleSet } from "../../src/rules/types";

// ───────────────────────────────────────────────────────────────────────────
// Fixtures. Every one is a FUNCTION, called inside a test body — never a
// module-level constant that runs at import time. A fixture that throws at
// import time takes the whole file down and reports as a load failure, which
// is precisely the "compile or fixture error masquerading as TDD red" ADD §6.5
// warns about. Built this way, each test fails on its own reason.
// ───────────────────────────────────────────────────────────────────────────

/** Frozen fixture window. An INJECTED instant pair, never derived from a clock. */
const WINDOW: AnalysisWindow = {
  start: new Date("2026-05-01T00:00:00.000Z"),
  end: new Date("2026-05-08T00:00:00.000Z"),
};

/** Frozen fixture instant for every signal that carries one. */
const SIGNAL_AT = new Date("2026-05-03T09:15:00.000Z");

const SURFACE = "/checkout/payment";

/** The v1 rule set fetched BY VERSION, never "whatever is current" (D-14). */
function ruleSetV1(): ThresholdRuleSet {
  const rules = THRESHOLD_RULE_SETS.get(1);
  if (!rules) throw new Error("rule set version 1 must remain resolvable forever");
  return rules;
}

const ALL_CLASSES: readonly FindingClass[] = findingClassSchema.options;

/**
 * A claim, as the gate receives it.
 *
 * `detector` is `"funnel_dropoff"` for every fixture including the
 * `changed_mind` and `instrumentation` ones. That is not an endorsement of a
 * detector proposing those classes — D-9 bars `changed_mind` from
 * `DetectorProposedClass` and ESC-3 records that `instrumentation` has no
 * producer this sprint. `ProposedClaim.detector` is nonetheless a required
 * `DetectorName`, so a fixture has to name one; the gate's verdict must not
 * depend on which.
 */
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

/** An exception tied to the user's action inside the correlation window. */
function failureCorrelated(ruleSet: ThresholdRuleSet): EvidenceSignal {
  return {
    kind: "failure_correlated",
    eventName: ruleSet.exceptionEventName,
    occurredAt: SIGNAL_AT,
    precedingActionName: "submit_payment",
    correlationWindowMs: ruleSet.errorCorrelationWindowMs,
  };
}

/**
 * An exception that could NOT be tied to a preceding action (ES-13). Recorded
 * honestly rather than laundered into a correlated one, and deliberately not
 * admissible as proof of `broken`.
 */
function failureUncorrelated(ruleSet: ThresholdRuleSet): EvidenceSignal {
  return {
    kind: "failure_uncorrelated",
    eventName: ruleSet.exceptionEventName,
    occurredAt: SIGNAL_AT,
  };
}

/** The cohort every struggle fixture is measured over. Held fixed, so the only
 * thing that ever moves in these fixtures is a numerator. */
const STRUGGLE_COHORT_KEPT = 40;

/** Clears `struggleMinStrugglingSessions` without sitting on its boundary —
 * `predicates.test.ts` walks that boundary; this file is about the ladder. */
const STRUGGLING_SESSIONS_ABOVE_MINIMUM = 8;

/**
 * A repeated-attempt struggle carrying BOTH magnitudes the predicate reads: the
 * per-session depth (`attempts`, PL ruling 31) and the cohort that reached it
 * (`strugglingSessions`, H-1). The cohort defaults above the minimum, so no
 * fixture here can pass or fail for a reason this file is not about.
 */
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

/**
 * The subkind that is NOT admissible proof (PL ruling 36) and IS still a
 * `changed_mind` disqualifier (ruling 19).
 *
 * `attempts: 1` is the point: a single back-navigation. Its cohort is
 * deliberately above every minimum, so nothing below can turn on the fixture
 * being too small — the refusal is the SUBKIND's.
 */
function backtrack(): EvidenceSignal {
  return {
    kind: "struggle",
    subkind: "backtrack",
    surface: SURFACE,
    attempts: 1,
    strugglingSessions: sessions(STRUGGLING_SESSIONS_ABOVE_MINIMUM, STRUGGLE_COHORT_KEPT),
  };
}

/** The tempting signal: a user who clicked once and left. */
function cleanExit(): EvidenceSignal {
  return { kind: "clean_exit", surface: SURFACE };
}

/**
 * A count built through the ONLY constructor (D-8) — the brand cannot be
 * fabricated by an object literal, which is exactly the property FR-10 asks
 * for, so these fixtures go through `measuredCount` like production does.
 */
function sessions(numerator: number, kept: number): MeasuredCount {
  return measuredCount({
    numerator,
    denominator: kept,
    unit: "sessions",
    timeframe: WINDOW,
    basis: { totalInWindow: kept, kept, setAside: [] },
  });
}

/**
 * An instrumentation signal whose observed and expected counts share one
 * denominator, so the "observed count vs expected count" reading and the
 * "observed rate vs expected rate" reading of the threshold COINCIDE. The
 * assertions below therefore pin the magnitude that matters rather than a
 * particular arithmetic spelling of it.
 */
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

/** The classes the descent visited, in order. */
function visitedClasses(outcome: GateOutcome): readonly FindingClass[] {
  return outcome.trace.map((entry) => entry.class);
}

// ═══════════════════════════════════════════════════════════════════════════
// DIRECT CELLS — one test per cell of architecture D-3's table (8)
// ═══════════════════════════════════════════════════════════════════════════

describe("evidence gate — direct cells (D-3)", () => {
  test("should pass broken when a failure signal is correlated to the action", () => {
    const ruleSet = ruleSetV1();

    const outcome = evaluate(claim("broken", [failureCorrelated(ruleSet)]), ruleSet);

    expect(outcome.kind).toBe("pass");
    if (outcome.kind !== "pass") throw new Error("unreachable — narrowing only");
    expect(outcome.finalClass).toBe("broken");
    // ES-15: a PASSING claim carries its satisfied entry, so "we checked and
    // it held" is never confusable with "we did not check".
    expect(visitedClasses(outcome)).toEqual(["broken"]);
    expect(outcome.trace[0]?.satisfied).toBe(true);
  });

  test("should downgrade broken to confusing when no correlated failure signal exists", () => {
    const ruleSet = ruleSetV1();

    // An UNCORRELATED exception plus a struggle signal. The uncorrelated
    // exception must not satisfy `broken` (ES-13) — that is the
    // over-permissive predicate the PRD names as a High risk — so the claim
    // descends one rung and lands on the proof it actually has.
    //
    // The struggle signal is a REPEATED ATTEMPT, not a back-navigation: PL
    // ruling 36 makes `backtrack` inadmissible as proof, so a fixture built
    // from one would exercise the floor rather than the downgrade this cell is
    // about. The cell is unchanged; only the evidence that can carry it is.
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

  // ── INVERTED BY PL RULING 36, AND KEPT. ───────────────────────────────────
  //
  // This test used to construct `backtrack()` with `attempts: 1` and assert it
  // PASSED as `confusing`. That was the defect: a single back-navigation is a
  // superset of its target — users navigate back constantly — admitted at any
  // magnitude, at the one gate between drop-off arithmetic and a delivered
  // finding. Ruling 36 makes `backtrack` inadmissible as proof; the test is not
  // deleted, because it is now the assertion that the ruling HOLDS.
  //
  // The ADD's cell is unchanged: `confusing` passes on proof of hesitation or
  // repeated attempts. What changed is which SIGNAL may carry it this sprint.
  test("should pass confusing on repeated attempts, and NOT on a back-navigation alone", () => {
    const ruleSet = ruleSetV1();

    // INCLUSIVE at the boundary (D-6): exactly `struggleRepeatedAttemptMin`
    // attempts, by exactly `struggleMinStrugglingSessions` sessions, is a
    // struggle. Fail direction is carried by the magnitudes, never by the
    // strictness of the comparison.
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

    // AND THE INVERSION (ruling 36). `backtrack` alone proves nothing, so the
    // claim finds no proof at its own rung, hits FR-13B's floor, and DROPS —
    // never a softer claim, and never `changed_mind`.
    const backtracked = evaluate(claim("confusing", [backtrack()]), ruleSet);

    expect(backtracked.kind).toBe("drop");
    expect(backtracked).not.toHaveProperty("finalClass");
    expect(visitedClasses(backtracked)).toEqual(["confusing"]);
    expect(backtracked.trace[0]?.satisfied).toBe(false);
    expect(JSON.stringify(backtracked)).not.toContain("changed_mind");

    // RULING 19 IS UNCHANGED, and this is the half that must not be weakened:
    // the same inadmissible signal still DISQUALIFIES `changed_mind`, because
    // that class's proof is the absence of everything. "Proves nothing" and
    // "shows nothing happened" are different statements.
    const flattering = evaluate(claim("changed_mind", [cleanExit(), backtrack()]), ruleSet);
    expect(flattering.kind).toBe("drop");
  });

  test("should downgrade confusing when no struggle signal exists", () => {
    const ruleSet = ruleSetV1();

    // THE DESTINATION IS `drop`, NOT `changed_mind` (D-10). The claim carries
    // a clean exit — the signal that WOULD satisfy `changed_mind` — precisely
    // so this test fails loudly if the floor is ever "fixed" into an ordering
    // that continues past `confusing`.
    const outcome = evaluate(claim("confusing", [cleanExit()]), ruleSet);

    expect(outcome.kind).toBe("drop");
    expect(outcome).not.toHaveProperty("finalClass");
    expect(visitedClasses(outcome)).toEqual(["confusing"]);
    expect(visitedClasses(outcome)).not.toContain("changed_mind");
  });

  test("should pass changed_mind when originally proposed with clean exit, no error, and no struggle signal", () => {
    const ruleSet = ruleSetV1();

    // ORIGINALLY PROPOSED — the O-005 path. FR-13B floors the CASCADE; it does
    // not weaken an originally-proposed `changed_mind` whose proof is
    // positively present.
    const outcome = evaluate(claim("changed_mind", [cleanExit()]), ruleSet);

    expect(outcome.kind).toBe("pass");
    if (outcome.kind !== "pass") throw new Error("unreachable — narrowing only");
    expect(outcome.finalClass).toBe("changed_mind");
    expect(visitedClasses(outcome)).toEqual(["changed_mind"]);
    expect(outcome.trace[0]?.satisfied).toBe(true);
  });

  test("should drop changed_mind when an error or struggle signal is present", () => {
    const ruleSet = ruleSetV1();

    // The ABSENCE half of the predicate is the load-bearing one. Each of these
    // three carries a clean exit — the PRESENT half is satisfied every time —
    // and each must still drop.
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
    const expectedNumerator = ruleSet.instrumentationMinExpected * 2; // 100 — comfortably above the baseline floor
    // EXACTLY at the threshold: 20 observed against 100 expected is 20%, and
    // `instrumentationDropRatioPercent` is 20. D-6: boundaries are INCLUSIVE,
    // so "at the threshold" fires. PL ruling 1: compared as exact integer
    // arithmetic (`observed * 100 <= percent * expected`), never float
    // division, so this boundary is exact rather than ulp-fragile.
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
    const expectedNumerator = ruleSet.instrumentationMinExpected * 2; // 100

    // One above the inclusive boundary: 21 of 100 expected is 21% > 20%.
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

    // FAIL DIRECTION: UNDER-DETECT (FR-9). A baseline below
    // `instrumentationMinExpected` supports no rate claim at all, however
    // dramatic the apparent collapse — 0 of 40 is still not a finding.
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

// ═══════════════════════════════════════════════════════════════════════════
// CASCADE AND FLOOR (4)
// ═══════════════════════════════════════════════════════════════════════════

describe("evidence gate — cascade and floor (FR-13, FR-13B)", () => {
  test("THE INCIDENT TEST — should DROP a broken claim over a session with a clean single-click exit and no failure signal, never surface it as changed_mind", () => {
    const ruleSet = ruleSetV1();

    // BS-1(c), replayed exactly. The session BS-1(a) describes: a save
    // silently fails — nothing throws, no request event fires, and the current
    // `events` schema cannot see it at all. The user clicks once and leaves.
    // What survives into the corpus is a clean exit and NOTHING ELSE.
    //
    // Trace the ladder: `broken` finds no correlated failure signal ->
    // downgrade -> `confusing` finds no hesitation, because the user clicked
    // once and left -> downgrade -> AND HERE THE FLOOR MUST HOLD. Left
    // unfloored, the next rung would be `changed_mind`, whose proof is "clean
    // exit, no error, no struggle" — ALL THREE LITERALLY TRUE of this session
    // — and the product would tell a founder "this user changed their mind"
    // when the product BROKE UNDER THEM.
    //
    // The honest output for this session is NOTHING AT ALL (ESC-1, ESC-5).
    // "No verdict beats a wrong verdict."
    const outcome = evaluate(claim("broken", [cleanExit()]), ruleSet);

    expect(outcome.kind).toBe("drop");
    // `drop` carries no class at all, because there is nothing to say.
    expect(outcome).not.toHaveProperty("finalClass");
    // The descent reached the floor by walking the ladder, not by an early
    // exit — and `changed_mind` was never even EVALUATED, let alone returned.
    expect(visitedClasses(outcome)).toEqual(["broken", "confusing"]);
    expect(visitedClasses(outcome)).not.toContain("changed_mind");
    expect(outcome.trace.every((entry) => entry.satisfied === false)).toBe(true);
    // Belt and braces: the string must not appear ANYWHERE in the verdict.
    expect(JSON.stringify(outcome)).not.toContain("changed_mind");
  });

  test("should cascade a broken claim with neither failure nor struggle signal past confusing to the floor and drop it", () => {
    const ruleSet = ruleSetV1();

    // No signals at all — the emptiest possible claim. Distinct from THE
    // INCIDENT TEST, which carries the one tempting signal.
    const outcome = evaluate(claim("broken", []), ruleSet);

    expect(outcome.kind).toBe("drop");
    expect(outcome).not.toHaveProperty("finalClass");
    expect(visitedClasses(outcome)).toEqual(["broken", "confusing"]);
    expect(outcome.trace.every((entry) => entry.satisfied === false)).toBe(true);
    // FR-14: a downgrade that leaves no trace is indistinguishable from a
    // detector that never fired.
    expect(outcome.trace.length).toBeGreaterThanOrEqual(2);
  });

  test("should cascade a confusing claim with no struggle signal to the floor and drop it, regardless of a clean exit", () => {
    const ruleSet = ruleSetV1();

    // "Regardless of a clean exit" is the whole point: the clean exit is
    // present, is genuine, and is IRRELEVANT, because `confusing`'s floor is
    // `drop` and the ladder does not continue to the class that clean exit
    // would satisfy.
    const withCleanExit = evaluate(claim("confusing", [cleanExit()]), ruleSet);
    const withoutAnySignal = evaluate(claim("confusing", []), ruleSet);
    // An uncorrelated exception is not a struggle signal either.
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
    // ASSERTED OVER `DOWNGRADE_PATH`'s VALUES DIRECTLY, not over behaviour
    // (D-10). A behavioural assertion here can pass VACUOUSLY — it passes when
    // the fixture simply never reaches the rung — whereas a direct assertion
    // that no row's value is `"changed_mind"` cannot pass for the wrong
    // reason. This is the structural guarantee behind THE INCIDENT TEST.

    // (a) No row names `changed_mind` as its destination. One statement,
    //     enumerated over the whole map so a fifth class cannot slip past.
    const destinations: readonly DowngradeDestination[] = Object.values(DOWNGRADE_PATH);
    expect(destinations).not.toContain("changed_mind");

    // (b) The map is TOTAL over the class union — an unenumerated class would
    //     make (a) an assertion about a subset.
    expect(new Set(Object.keys(DOWNGRADE_PATH))).toEqual(new Set(ALL_CLASSES));

    // (c) Transitively, from EVERY starting class: walk the map to its fixed
    //     point and assert `changed_mind` is never entered as a destination.
    //     The walk also proves the map itself is acyclic, which is what makes
    //     the visited-set descent bounded rather than merely guarded.
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

    // (d) The floor itself, named. `changed_mind` keeps its own row so an
    //     ORIGINALLY PROPOSED one is evaluated normally and drops when its
    //     proof is absent — that row is a source, never a destination.
    expect(DOWNGRADE_PATH.confusing).toBe("drop");
    expect(DOWNGRADE_PATH.broken).toBe("confusing");
    expect(DOWNGRADE_PATH.changed_mind).toBe("drop");
    expect(DOWNGRADE_PATH.instrumentation).toBe("drop");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GATE INVARIANTS (4)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Every class reachable from `claimedClass` by DESCENDING — the claimed class
 * itself plus everything `DOWNGRADE_PATH` leads to. Computed here in the test,
 * independently of `isReachableClass`, so the invariant is checked against the
 * map rather than against the production helper that reads it.
 */
function descendantsOf(claimedClass: FindingClass): ReadonlySet<FindingClass> {
  const reachable = new Set<FindingClass>([claimedClass]);
  let current: DowngradeDestination = DOWNGRADE_PATH[claimedClass];
  while (current !== "drop" && !reachable.has(current)) {
    reachable.add(current);
    current = DOWNGRADE_PATH[current];
  }
  return reachable;
}

/** Every subset of `items`, smallest first. 2^n entries. */
function powerSet<T>(items: readonly T[]): readonly (readonly T[])[] {
  let subsets: (readonly T[])[] = [[]];
  for (const item of items) {
    subsets = subsets.concat(subsets.map((subset) => [...subset, item]));
  }
  return subsets;
}

/**
 * One representative signal of EVERY kind in the union. The powerset of these
 * five is every combination of evidence the gate can be handed — 32 of them,
 * across 4 starting classes, is the 128-cell matrix tests 13 and 14 walk.
 */
function everySignalKind(ruleSet: ThresholdRuleSet): readonly EvidenceSignal[] {
  return [
    failureCorrelated(ruleSet),
    failureUncorrelated(ruleSet),
    repeatedAttempt(ruleSet.struggleRepeatedAttemptMin),
    cleanExit(),
    rateDrop(0, ruleSet.instrumentationMinExpected * 2, 100),
  ];
}

describe("evidence gate — invariants (FR-13, D-10, ES-12)", () => {
  test("should never return a class stronger than the one claimed", () => {
    const ruleSet = ruleSetV1();

    // The sharp case first, stated on its own so a failure names it: a
    // `confusing` claim carrying a CORRELATED failure signal has, sitting
    // right there, everything `broken` needs. The gate must not take it. The
    // descent only ever moves ALONG `DOWNGRADE_PATH`, and nothing in it
    // ascends.
    const tempted = evaluate(claim("confusing", [failureCorrelated(ruleSet)]), ruleSet);
    expect(visitedClasses(tempted)).not.toContain("broken");
    if (tempted.kind === "pass") expect(tempted.finalClass).not.toBe("broken");

    // Then exhaustively, over every starting class and every signal
    // combination.
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
    // D-10: "termination is guaranteed by a visited-class set (a class is
    // never re-entered) over a four-member union, AND ASSERTED BY A TEST
    // rather than argued." So this enumerates the matrix and asserts the
    // observable consequences of termination — a bounded, strictly
    // non-repeating descent whose last rung is either satisfied or floors.
    let evaluated = 0;

    for (const claimedClass of ALL_CLASSES) {
      for (const signals of powerSet(everySignalKind(ruleSet))) {
        const outcome = evaluate(claim(claimedClass, signals), ruleSet);
        const visited = visitedClasses(outcome);
        evaluated += 1;

        // Bounded by the size of the class union — a descent that re-entered
        // a class would exceed this or never return at all.
        expect(visited.length).toBeGreaterThanOrEqual(1);
        expect(visited.length).toBeLessThanOrEqual(ALL_CLASSES.length);
        // NO CLASS IS EVER RE-ENTERED. This is the visited-set property
        // itself, observed through the trace.
        expect(new Set(visited).size).toBe(visited.length);
        // The descent starts at the claimed class and follows the map exactly
        // — never a jump, never a skipped rung.
        expect(visited[0]).toBe(claimedClass);
        for (let index = 1; index < visited.length; index += 1) {
          expect(DOWNGRADE_PATH[visited[index - 1] as FindingClass]).toBe(
            visited[index] as FindingClass,
          );
        }
        // Every rung before the last failed; the last one explains the
        // verdict.
        for (let index = 0; index < outcome.trace.length - 1; index += 1) {
          expect(outcome.trace[index]?.satisfied).toBe(false);
        }
        const last = outcome.trace[outcome.trace.length - 1];
        if (outcome.kind === "pass") {
          expect(last?.satisfied).toBe(true);
          expect(outcome.finalClass).toBe(last?.class as FindingClass);
        } else {
          expect(last?.satisfied).toBe(false);
          // A drop only ever happens AT THE FLOOR — never by running out of
          // map.
          expect(DOWNGRADE_PATH[last?.class as FindingClass]).toBe("drop");
        }
      }
    }

    // 4 starting classes x 2^5 signal combinations. Asserted so a silently
    // shrunken matrix cannot make this test vacuous.
    expect(evaluated).toBe(ALL_CLASSES.length * 2 ** 5);
  });

  test("should reject an unknown finding class at the Zod boundary, never default it to the weakest class", () => {
    const ruleSet = ruleSetV1();

    // ES-12. A claim naming a class the gate has no predicate for is
    // MALFORMED INPUT. Defaulting it — to the weakest class, to the most
    // flattering one, or to anything at all — silently converts a bad input
    // into a shippable claim, which is the one thing this gate exists to stop.
    // A model's output (O-005) is external data and is validated like any
    // other.
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

      // NOT DEFAULTED: no verdict of any kind came back.
      expect(returned).toBeUndefined();
      // REJECTED AT THE ZOD BOUNDARY specifically — a bare `Error` would mean
      // the rejection happened somewhere else, or not at all.
      expect(thrown).toBeInstanceOf(z.ZodError);
      const issuePaths = (thrown as z.ZodError).issues.map((issue) => issue.path.join("."));
      expect(issuePaths).toContain("claimedClass");
    }
  });

  test("should carry the FR-13B rationale as a code comment at the floor's implementation site", async () => {
    // D-10: "a future contributor will read `confusing -> drop` as a gap in an
    // obvious ordering and 'fix' it. The comment is the only thing standing
    // between that reading and the incident." A comment that load-bearing is
    // a contract, so a test guards it — deleting it must break the build, not
    // merely lose some prose.
    //
    // Read through `Bun.file` and `import.meta.dir`, NOT `node:fs`: this
    // package imports no node builtin anywhere, in `src/` or in `__tests__/`,
    // which is what makes FR-5's purity auditable by construction (D-13).
    const source = await Bun.file(`${import.meta.dir}/../../src/evidence/gate.ts`).text();
    const lines = source.split("\n");

    const floorIndex = lines.findIndex((line) => /^\s*confusing:\s*"drop",/.test(line));
    expect(floorIndex).toBeGreaterThan(-1);

    // The contiguous comment block immediately ABOVE the floor line. "At the
    // implementation site" means exactly that — a rationale parked at the top
    // of the file is a rationale a contributor editing this line will not see.
    let blockStart = floorIndex;
    while (blockStart > 0 && /^\s*(\/\/|\/\*|\*)/.test(lines[blockStart - 1] ?? "")) {
      blockStart -= 1;
    }
    const rationaleLines = lines.slice(blockStart, floorIndex);
    const rationale = rationaleLines.join("\n");

    // It must be a real explanation, not a label.
    expect(rationaleLines.length).toBeGreaterThanOrEqual(5);
    // It must name the requirement, so the reader can find the decision.
    expect(rationale).toContain("FR-13B");
    // It must name the class the floor exists to keep unreachable — the whole
    // point of the comment is that `changed_mind` is not the next rung.
    expect(rationale).toContain("changed_mind");
    // And the comment must describe the value that is actually there.
    expect(rationale).toContain("drop");
    expect(DOWNGRADE_PATH.confusing).toBe("drop");
  });
});
