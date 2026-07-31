// ADD §7 "Unit — evidence predicates" — the eight named tests for the proof
// predicates (D-11, FR-12, FR-15, FR-19), plus the one D-14 assertion PL
// ruling 6 requires.
//
// What this file is for, in one sentence: the evidence gate is the product's
// identity, and these predicates are the only thing standing between "we can
// prove it" and "we said it". §6's three-way split is pass / downgrade /
// reject, and a `broken` claim without the failed-or-absent request degrades
// to `confusing` rather than being asserted.
//
// THE LOAD-BEARING ONE IS THE NEGATIVE. `failure_uncorrelated` is deliberately
// NOT admissible proof of `broken` (ES-13): an `$exception` that could not be
// tied to the user's action is not evidence that the user's action broke, and
// admitting it is exactly the over-permissive predicate the PRD names as a
// High risk.
//
// House rules honoured here (STATE.md standing constraints):
//   - FIXTURE TIME IS A REQUIRED PARAMETER. There is no `Date.now()` in this
//     file; every instant is one of the frozen constants below.
//   - D-14: every predicate is handed a rule set as a PARAMETER, and the rule
//     set is fetched BY VERSION (`THRESHOLD_RULE_SETS.get(1)`), never as
//     "whatever is current". A dedicated test proves the predicates read their
//     signal lists off that parameter rather than off the module constants.
//   - D-6: boundaries are INCLUSIVE, and the two instrumentation tests sit
//     exactly on theirs. PL ruling 1: `instrumentationDropRatioPercent` is an
//     INTEGER PERCENT (20), compared with exact integer arithmetic.
//   - No node builtin. The one test that reads source text uses `Bun.file` and
//     `import.meta.dir`, not `node:fs`.
import { describe, expect, test } from "bun:test";

import type { MeasuredCount } from "../../src/counts/measured-count";
import { measuredCount } from "../../src/counts/measured-count";
import {
  brokenProofSatisfied,
  changedMindProofSatisfied,
  confusingProofSatisfied,
  instrumentationProofSatisfied,
} from "../../src/evidence/predicates";
import type { EvidenceSignal, EvidenceSignalKind } from "../../src/evidence/signals";
import { BROKEN_PROOF_SIGNALS_V1 } from "../../src/evidence/signals";
import { THRESHOLD_RULE_SETS } from "../../src/rules/thresholds";
import type { ThresholdRuleSet } from "../../src/rules/types";

// --- frozen fixture time (STATE.md: no `Date.now()` anywhere) ---------------

const WINDOW_START = new Date("2026-07-01T00:00:00.000Z");
const WINDOW_END = new Date("2026-07-08T00:00:00.000Z");
const EXCEPTION_AT = new Date("2026-07-03T12:00:00.000Z");

// --- rule set, fetched by version, never "current" (D-14) -------------------

/** The v1 rule set fetched BY VERSION. After v2 lands this still reproduces a
 * v1 verdict exactly, which is the property D-14 exists to give us. */
function ruleSetV1(): ThresholdRuleSet {
  const rules = THRESHOLD_RULE_SETS.get(1);
  if (!rules) throw new Error("rule set version 1 must remain resolvable forever");
  return rules;
}

// --- signal fixtures --------------------------------------------------------

function failureCorrelated(): EvidenceSignal {
  return {
    kind: "failure_correlated",
    eventName: "$exception",
    occurredAt: EXCEPTION_AT,
    precedingActionName: "save_clicked",
    correlationWindowMs: 30_000,
  };
}

function failureUncorrelated(): EvidenceSignal {
  return { kind: "failure_uncorrelated", eventName: "$exception", occurredAt: EXCEPTION_AT };
}

/** `attempts` is a REQUIRED parameter so no test can accidentally lean on a
 * default that happens to sit on the right side of `struggleRepeatedAttemptMin`. */
function struggle(attempts: number): EvidenceSignal {
  return { kind: "struggle", subkind: "repeated_attempt", surface: "/checkout", attempts };
}

/** The OTHER struggle subkind. No producer this sprint (ruling 18), admitted
 * on kind alone — so it carries no magnitude gate and must block
 * `changed_mind` at any `attempts`, zero included. */
function backtrack(attempts: number): EvidenceSignal {
  return { kind: "struggle", subkind: "backtrack", surface: "/checkout", attempts };
}

function cleanExit(): EvidenceSignal {
  return { kind: "clean_exit", surface: "/checkout" };
}

function sessionsCount(numerator: number, denominator: number): MeasuredCount {
  return measuredCount({
    numerator,
    denominator,
    unit: "sessions",
    timeframe: { start: WINDOW_START, end: WINDOW_END },
    basis: { totalInWindow: denominator, kept: denominator, setAside: [] },
  });
}

/**
 * Observed and expected deliberately share ONE denominator, so "observed is
 * 20% of expected" reads identically whether the predicate compares the two
 * numerators or the two rates. The test therefore pins the THRESHOLD BEHAVIOUR
 * without pinning an implementation detail the ADD never fixed.
 */
const RATE_DROP_DENOMINATOR = 200;

function rateDrop(observedNumerator: number, expectedNumerator: number): EvidenceSignal {
  return {
    kind: "instrumentation_rate_drop",
    eventName: "checkout_completed",
    observed: sessionsCount(observedNumerator, RATE_DROP_DENOMINATOR),
    expected: sessionsCount(expectedNumerator, RATE_DROP_DENOMINATOR),
  };
}

/** One representative signal per kind, built LAZILY (per kind, on demand) so a
 * test that only walks `["failure_correlated"]` never constructs a count. */
function signalOfKind(kind: EvidenceSignalKind): EvidenceSignal {
  switch (kind) {
    case "failure_correlated":
      return failureCorrelated();
    case "failure_uncorrelated":
      return failureUncorrelated();
    case "struggle":
      return struggle(3);
    case "clean_exit":
      return cleanExit();
    case "instrumentation_rate_drop":
      return rateDrop(0, 100);
  }
}

// --- source-text helper (test 3) -------------------------------------------

/**
 * The contiguous run of `//` comment lines immediately above `declaration`.
 * "Carrying the comment" means the comment sits AT the constant — a matching
 * string somewhere else in the file does not count.
 */
function commentBlockAbove(source: string, declaration: string): string {
  const at = source.indexOf(declaration);
  if (at === -1) throw new Error(`declaration not found in source: ${declaration}`);
  const linesBefore = source.slice(0, at).split("\n");
  const block: string[] = [];
  for (let i = linesBefore.length - 1; i >= 0; i -= 1) {
    const line = linesBefore[i];
    if (line.trimStart().startsWith("//")) {
      block.unshift(line);
      continue;
    }
    // The partial line the declaration starts on, and nothing else, may be blank.
    if (line.trim() === "" && block.length === 0) continue;
    break;
  }
  return block.join("\n");
}

// ---------------------------------------------------------------------------
// broken
// ---------------------------------------------------------------------------

describe("brokenProofSatisfied (FR-12, FR-19, ES-13)", () => {
  test("should satisfy broken proof when a failure_correlated signal is present", () => {
    expect(brokenProofSatisfied([failureCorrelated()], ruleSetV1())).toBe(true);
  });

  test("should NOT satisfy broken proof from a failure_uncorrelated signal", () => {
    const rules = ruleSetV1();

    // The whole of ES-13 in one line: an exception the pipeline could not tie
    // to a preceding action inside the window is recorded HONESTLY as
    // uncorrelated — and is then not proof of anything.
    expect(brokenProofSatisfied([failureUncorrelated()], rules)).toBe(false);

    // Uncorrelated exceptions do not ACCUMULATE into proof either. Three
    // coincidences are still coincidences; volume is not correlation.
    expect(
      brokenProofSatisfied(
        [failureUncorrelated(), failureUncorrelated(), failureUncorrelated()],
        rules,
      ),
    ).toBe(false);

    // And a correlated signal sitting BESIDE uncorrelated ones still proves
    // `broken` — the exclusion is of the uncorrelated kind, not a poisoning of
    // the whole signal list.
    expect(brokenProofSatisfied([failureUncorrelated(), failureCorrelated()], rules)).toBe(true);
  });

  test("should name BROKEN_PROOF_SIGNALS_V1 as a versioned constant carrying the BS-1(a) blind-spot comment", async () => {
    const source = await Bun.file(`${import.meta.dir}/../../src/evidence/signals.ts`).text();
    const comment = commentBlockAbove(source, "export const BROKEN_PROOF_SIGNALS_V1");

    // (a) VERSIONED. The name carries its version, and the v1 rule set wires
    // this exact constant — that is what makes FR-19's "admitting a new signal
    // is a one-line addition plus a version bump" true rather than claimed.
    expect(source).toContain("export const BROKEN_PROOF_SIGNALS_V1");
    expect(BROKEN_PROOF_SIGNALS_V1).toEqual(["failure_correlated"]);
    expect(ruleSetV1().brokenProofSignals).toBe(BROKEN_PROOF_SIGNALS_V1);

    // (b) THE ESCALATION LIVES IN CODE (ESC-1). BS-1(a) is the absent request:
    // the silent no-op save where nothing throws and no event fires. It is
    // undetectable over the current `events` schema — no `properties` column,
    // no status code, no network-request property — and this comment is the
    // only place a future contributor meets that fact before trusting the
    // predicate. A test asserts it stays there.
    expect(comment).toContain("KNOWN BLIND SPOT");
    expect(comment).toContain("BS-1a");
    expect(comment).toContain("properties");
    expect(comment).toContain("status code");
    expect(comment).toContain("network-request property");
    expect(comment).toContain("ESC-1");

    // (c) The constant is not decorative: every kind it lists is admitted by
    // the predicate. Without this, "one-line change" would be a comment rather
    // than a property of the code.
    for (const kind of BROKEN_PROOF_SIGNALS_V1) {
      expect(brokenProofSatisfied([signalOfKind(kind)], ruleSetV1())).toBe(true);
    }
  });

  test("should downgrade a broken claim with struggle signals but no failure signal to confusing", () => {
    const rules = ruleSetV1();
    // A user who tried three times and never saw an exception. We can prove
    // they struggled; we cannot prove anything broke.
    const signals = [
      struggle(rules.struggleRepeatedAttemptMin),
      struggle(rules.struggleRepeatedAttemptMin),
    ];

    // This file asserts the PREDICATE PAIR that produces the downgrade — the
    // `broken` rung fails, the `confusing` rung it steps to succeeds. The
    // descent itself (DOWNGRADE_PATH, the trace) is gate.test.ts's subject.
    expect(brokenProofSatisfied(signals, rules)).toBe(false);
    expect(confusingProofSatisfied(signals, rules)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// confusing
// ---------------------------------------------------------------------------

describe("confusingProofSatisfied (FR-12, FR-9, D-6)", () => {
  test("should satisfy confusing proof when a struggle signal is present", () => {
    const rules = ruleSetV1();

    // INCLUSIVE at exactly the threshold (D-6). Fail direction is carried by
    // the magnitude — "two visits to a path is navigation; three is a
    // pattern" — never by boundary strictness.
    expect(confusingProofSatisfied([struggle(rules.struggleRepeatedAttemptMin)], rules)).toBe(true);
    expect(confusingProofSatisfied([struggle(rules.struggleRepeatedAttemptMin + 1)], rules)).toBe(
      true,
    );

    // The complement, so the test cannot pass against a predicate that returns
    // true for everything: one attempt below the minimum is not a struggle.
    expect(confusingProofSatisfied([struggle(rules.struggleRepeatedAttemptMin - 1)], rules)).toBe(
      false,
    );

    // No signal at all proves nothing.
    expect(confusingProofSatisfied([], rules)).toBe(false);
  });

  // FR-22 / FR-9 (Wave 7). The assertion for this direction already existed
  // above, as the positive test's own negative control — and it stays there,
  // because a positive test keeping its complement is what stops it passing
  // against a predicate that returns `true` for everything.
  //
  // What did NOT exist was a test whose NAME states the direction. That is the
  // whole of FR-22's requirement here: a reader scanning this suite, or the
  // coverage map in `coverage.test.ts` scanning it mechanically, must be able to
  // see which way `struggleRepeatedAttemptMin` fails without opening the file
  // and reading the assertions inside a test called "should satisfy…".
  test("should not satisfy confusing proof below struggleRepeatedAttemptMin", () => {
    const rules = ruleSetV1();
    const belowMinimum = rules.struggleRepeatedAttemptMin - 1;

    // The near miss must be a REAL revisit, or this degenerates into the
    // single-attempt case and stops testing the boundary at all.
    expect(belowMinimum).toBeGreaterThanOrEqual(2);

    // FAIL DIRECTION: UNDER-DETECT (FR-9). "Two visits to a path is navigation;
    // three is a pattern" — so one below the minimum is not proof of confusion,
    // and the consequence is deliberate: a `confusing` claim with no proof hits
    // the FR-13B floor and is DROPPED. Silence, not a softer claim (ADD
    // trade-off 6, ESC-1).
    expect(confusingProofSatisfied([struggle(belowMinimum)], rules)).toBe(false);
    expect(confusingProofSatisfied([struggle(1)], rules)).toBe(false);

    // Sub-threshold struggles do not ACCUMULATE into proof either. Three people
    // each glancing at a page twice is not one person stuck on it — the same
    // per-session reading `funnel-dropoff.test.ts` pins on the producing side
    // (PL ruling 31).
    expect(
      confusingProofSatisfied(
        [struggle(belowMinimum), struggle(belowMinimum), struggle(belowMinimum)],
        rules,
      ),
    ).toBe(false);

    // NON-VACUITY, AND THE INCLUSIVE HALF (D-6): the same predicate, the same
    // signal kind, one attempt higher, DOES fire. So every `false` above is this
    // magnitude holding — never a predicate that rejects struggle signals
    // outright. (PL ruling 18: the minimum gates the `repeated_attempt` subkind
    // only, which is what `struggle()` builds.)
    expect(confusingProofSatisfied([struggle(rules.struggleRepeatedAttemptMin)], rules)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// changed_mind — the class whose proof is the ABSENCE of everything
// ---------------------------------------------------------------------------

describe("changedMindProofSatisfied (FR-12)", () => {
  test("should satisfy changed_mind proof only when clean_exit is present AND no failure and no struggle signal exist", () => {
    const rules = ruleSetV1();

    // The presence half.
    expect(changedMindProofSatisfied([cleanExit()], rules)).toBe(true);

    // The ABSENCE half, which is the load-bearing one and which the signal
    // LIST cannot express — a list can only say what must be present. Each
    // case below carries `clean_exit`, so anything other than `false` means
    // the absence requirement is not being enforced in the predicate.
    expect(changedMindProofSatisfied([cleanExit(), failureCorrelated()], rules)).toBe(false);
    expect(changedMindProofSatisfied([cleanExit(), failureUncorrelated()], rules)).toBe(false);
    expect(
      changedMindProofSatisfied([cleanExit(), struggle(rules.struggleRepeatedAttemptMin)], rules),
    ).toBe(false);

    // And the presence half is still required: absence alone is not proof.
    expect(changedMindProofSatisfied([], rules)).toBe(false);
  });

  // ── PL RULING 19, AT THE MAGNITUDE THAT MATTERS ────────────────────────────
  //
  // Fail direction: UNDER-DETECT toward `drop`. A struggle signal of ANY
  // subkind at ANY magnitude blocks `changed_mind`.
  //
  // WHY THIS TEST EXISTS SEPARATELY, and why the case above does not cover it.
  // The test above feeds a struggle at EXACTLY `struggleRepeatedAttemptMin` —
  // a magnitude strong enough to prove `confusing` on its own. So it passes
  // whether the disqualification is KIND-level (correct, ruling 19) or
  // MAGNITUDE-level (wrong). The distinction only becomes visible BELOW the
  // threshold.
  //
  // The regression it guards: routing the disqualification through
  // `anySignalProves(signals, ["struggle"], ruleSet)` — which is
  // magnitude-gated, reads naturally, and looks like a tidy reuse of the
  // helper the other two predicates use. That change would let a session with
  // one or two visible repeated attempts pass as `changed_mind`: the product
  // telling a founder "they simply moved on" about a user who was visibly
  // struggling. `changed_mind` is the most product-flattering class there is,
  // and its proof is the ABSENCE of everything — so a sub-threshold struggle
  // is still evidence that something happened, which is the whole claim.
  test("should block changed_mind on a struggle signal of any kind at any magnitude", () => {
    const rules = ruleSetV1();

    // NON-VACUITY. Without a struggle present the predicate is satisfied, so
    // every `false` below is the struggle doing the work and not a fixture
    // that fails for some unrelated reason.
    expect(changedMindProofSatisfied([cleanExit()], rules)).toBe(true);

    // (1) SUB-THRESHOLD `repeated_attempt`, every magnitude below the minimum
    // down to zero. Each is too weak to PROVE `confusing` — asserted directly
    // — and each must still block `changed_mind`.
    for (let attempts = 0; attempts < rules.struggleRepeatedAttemptMin; attempts += 1) {
      const weak = struggle(attempts);

      // The magnitude really is sub-threshold: this signal cannot prove
      // `confusing`. If this ever goes true the loop is testing nothing.
      expect(confusingProofSatisfied([weak], rules)).toBe(false);

      // ...and yet it blocks the flattering class.
      expect(changedMindProofSatisfied([cleanExit(), weak], rules)).toBe(false);
    }

    // (2) The `backtrack` SUBKIND, which has no producer this sprint (ruling
    // 18) and is admitted on kind alone. It must block regardless of
    // magnitude — including at zero attempts, where any magnitude gate would
    // wave it through.
    expect(changedMindProofSatisfied([cleanExit(), backtrack(0)], rules)).toBe(false);
    expect(changedMindProofSatisfied([cleanExit(), backtrack(1)], rules)).toBe(false);
    expect(
      changedMindProofSatisfied([cleanExit(), backtrack(rules.struggleRepeatedAttemptMin)], rules),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// instrumentation
// ---------------------------------------------------------------------------

describe("instrumentationProofSatisfied (FR-15, FR-9, D-6, PL ruling 1)", () => {
  test("should satisfy instrumentation proof when the rate crosses instrumentationDropRatio", () => {
    const rules = ruleSetV1();

    // Comfortably clear of the expected-count floor, so this test isolates the
    // RATIO gate and nothing else.
    const expectedNumerator = rules.instrumentationMinExpected * 2;
    // PL ruling 1: the ratio is an INTEGER PERCENT (20), so the boundary is
    // exact integer arithmetic — `observed * 100 <= dropRatioPercent * expected`
    // — never `observed / expected >= 0.2`, which is ulp-fragile.
    const atBoundary = (expectedNumerator * rules.instrumentationDropRatioPercent) / 100;

    // INCLUSIVE (D-6): exactly at the ratio FIRES.
    expect(instrumentationProofSatisfied([rateDrop(atBoundary, expectedNumerator)], rules)).toBe(
      true,
    );

    // A collapse well past the ratio fires too.
    expect(instrumentationProofSatisfied([rateDrop(0, expectedNumerator)], rules)).toBe(true);

    // One session the safe side of the boundary does NOT fire — the complement
    // that stops this passing against an always-true predicate.
    expect(
      instrumentationProofSatisfied([rateDrop(atBoundary + 1, expectedNumerator)], rules),
    ).toBe(false);
  });

  test("should not satisfy instrumentation proof below instrumentationMinExpected", () => {
    const rules = ruleSetV1();

    // The most extreme ratio there is — the event stopped firing entirely —
    // on an expected baseline one session below the floor. It must still not
    // fire. FAIL DIRECTION: UNDER-DETECT (FR-9). "This event stopped firing"
    // is indistinguishable from "this event was always rare" down here, and a
    // false instrumentation claim burns the credibility the MVP exists to test.
    expect(
      instrumentationProofSatisfied([rateDrop(0, rules.instrumentationMinExpected - 1)], rules),
    ).toBe(false);

    // INCLUSIVE at the floor (D-6): exactly `instrumentationMinExpected` is a
    // large enough baseline, so the boundary is the magnitude's job, not the
    // comparison operator's.
    expect(
      instrumentationProofSatisfied([rateDrop(0, rules.instrumentationMinExpected)], rules),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D-14 — PL ruling 6: the predicates read their signal lists off the PARAMETER
// ---------------------------------------------------------------------------

describe("D-14 — predicates read the rule-set parameter, never the module constant", () => {
  test("should follow the rule set it is handed when its proof-signal list differs from v1", () => {
    // A hypothetical v2 that admits the uncorrelated kind (this is exactly the
    // one-line edit FR-19 promises, and exactly the edit ESC-1 says needs
    // first-party capture before it is safe). If the predicate reached for
    // `BROKEN_PROOF_SIGNALS_V1` directly instead of reading its parameter,
    // both assertions below would come out the v1 way and this test would
    // catch it.
    const admitsUncorrelated: ThresholdRuleSet = {
      ...ruleSetV1(),
      version: 2,
      brokenProofSignals: ["failure_uncorrelated"],
      confusingProofSignals: ["clean_exit"],
    };

    expect(brokenProofSatisfied([failureUncorrelated()], admitsUncorrelated)).toBe(true);
    expect(brokenProofSatisfied([failureCorrelated()], admitsUncorrelated)).toBe(false);

    expect(confusingProofSatisfied([cleanExit()], admitsUncorrelated)).toBe(true);
    expect(
      confusingProofSatisfied(
        [struggle(admitsUncorrelated.struggleRepeatedAttemptMin)],
        admitsUncorrelated,
      ),
    ).toBe(false);

    // And v1, re-fetched by version, is unchanged by any of it.
    expect(brokenProofSatisfied([failureUncorrelated()], ruleSetV1())).toBe(false);
  });
});
