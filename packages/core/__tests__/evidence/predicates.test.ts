// Unit tests for evidence predicates: the eight named tests for the proof predicates, plus the
// one assertion That decision requires.
//
// What this file is for, in one sentence: the evidence gate is the product's identity,
// and these predicates are the only thing standing between "we can prove it" and "we
// said it". the three-way split is pass / downgrade / reject, and a `broken` claim
// without the failed-or-absent request degrades to `confusing` rather than being
// asserted.
//
// The load-bearing one is the negative. `failure_uncorrelated` is deliberately not
// admissible proof of `broken`: an `$exception` that could not be tied to the
// user's action is not evidence that the user's action broke, and admitting it is
// exactly the over-permissive predicate the prd names as a High risk.
//
// House rules honoured here (state.md standing constraints):
// Fixture time is a required parameter. There is no `Date.now` in this
//  file; every instant is one of the frozen constants below.
// : every predicate is handed a rule set as a parameter, and the rule
//  set is fetched by version (`THRESHOLD_RULE_SETS.get`), never as
//  "whatever is current". A dedicated test proves the predicates read their
//  signal lists off that parameter rather than off the module constants.
// : boundaries are inclusive, and the two instrumentation tests sit
//  exactly on theirs: `instrumentationDropRatioPercent` is an
//  Integer percent, compared with exact integer arithmetic.
// No node builtin. The one test that reads source text uses `Bun.file` and
//  `import.meta.dir`, not `node:fs`.
import { describe, expect, test } from "bun:test";

import type { MeasuredCount } from "../../src/counts/measured-count";
import { measuredCount } from "../../src/counts/measured-count";
import {
  brokenProofSatisfied,
  changedMindProofSatisfied,
  confidenceBasisForPass,
  confusingProofSatisfied,
  instrumentationProofSatisfied,
} from "../../src/evidence/predicates";
import type { EvidenceSignal, EvidenceSignalKind } from "../../src/evidence/signals";
import { BROKEN_PROOF_SIGNALS_V1 } from "../../src/evidence/signals";
import { THRESHOLD_RULE_SETS } from "../../src/rules/thresholds";
import type { ThresholdRuleSet } from "../../src/rules/types";

// -- frozen fixture time (state.md: no `Date.now` anywhere)

const WINDOW_START = new Date("2026-07-01T00:00:00.000Z");
const WINDOW_END = new Date("2026-07-08T00:00:00.000Z");
const EXCEPTION_AT = new Date("2026-07-03T12:00:00.000Z");

// -- rule set, fetched by version, never "current"

/**
 * The version stamped on rule sets this file invents to exercise a predicate.
 *
 * It must never collide with a version the registry hands out, because a synthetic rule
 * set wearing a registered version is a identity fork: the moment anything persists
 * `thresholdRuleSetVersion`, a replay through `THRESHOLD_RULE_SETS.get` reproduces
 * a decision this rule set never made. Registered versions are positive and assigned in
 * increasing order (`src/rules/thresholds.ts`. "add version 3 for the next change"), so
 * a negative version collides with nothing today and with no future bump either. `3`
 * could not promise that.
 */
const SYNTHETIC_RULE_SET_VERSION = -1;

/** The v1 rule set fetched by version. After v2 lands this still reproduces a v1
 * verdict exactly, which is the property exists to give us. */
function ruleSetV1(): ThresholdRuleSet {
  const rules = THRESHOLD_RULE_SETS.get(1);
  if (!rules) throw new Error("rule set version 1 must remain resolvable forever");
  return rules;
}

// -- signal fixtures

function failureCorrelated(): EvidenceSignal {
  return {
    kind: "failure_correlated",
    eventName: "$exception",
    occurredAt: EXCEPTION_AT,
    precedingActionName: "save_clicked",
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
}

function failureUncorrelated(): EvidenceSignal {
  return { kind: "failure_uncorrelated", eventName: "$exception", occurredAt: EXCEPTION_AT };
}

/** The cohort every struggle fixture is measured over. Comfortably above every
 * magnitude in play, so a cohort numerator is the only thing that ever moves. */
const STRUGGLE_COHORT_KEPT = 40;

/** A cohort that clears `struggleMinStrugglingSessions` without sitting on its
 * boundary. The boundary itself is walked by its own test below. */
const STRUGGLING_SESSIONS_ABOVE_MINIMUM = 8;

/**
 * `attempts` is a required parameter so no test can accidentally lean on a default that
 * happens to sit on the right side of `struggleRepeatedAttemptMin`.
 *
 * `strugglingSessions` defaults to a cohort that clears
 * `struggleMinStrugglingSessions`, so every assertion written before that magnitude
 * existed still tests the magnitude it was written for. The tests that are about the
 * cohort pass it explicitly.
 */
function struggle(
  attempts: number,
  strugglingSessions: number = STRUGGLING_SESSIONS_ABOVE_MINIMUM,
): EvidenceSignal {
  return {
    kind: "struggle",
    subkind: "repeated_attempt",
    surface: "/checkout",
    attempts,
    strugglingSessions: sessionsCount(strugglingSessions, STRUGGLE_COHORT_KEPT),
  };
}

/** The other struggle subkind. No producer this sprint (ruling 18) and not admissible
 * proof at any magnitude (ruling 36), and it must still block `changed_mind` at any
 * `attempts`, zero included (ruling 19, unchanged).
 *
 * Its cohort is deliberately above every minimum: an assertion about `backtrack` must
 * turn on the subkind, never on a fixture that was quietly too small. */
function backtrack(attempts: number): EvidenceSignal {
  return {
    kind: "struggle",
    subkind: "backtrack",
    surface: "/checkout",
    attempts,
    strugglingSessions: sessionsCount(STRUGGLING_SESSIONS_ABOVE_MINIMUM, STRUGGLE_COHORT_KEPT),
  };
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
 * Observed and expected deliberately share one denominator, so "observed is 20% of
 * expected" reads identically whether the predicate compares the two numerators or the
 * two rates. The test therefore pins the threshold behaviour without pinning an
 * implementation detail the add never fixed.
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

/** One representative signal per kind, built lazily (per kind, on demand) so a test
 * that only walks `["failure_correlated"]` never constructs a count. */
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

// -- source-text helper (test 3)

/**
 * The contiguous run of `//` comment lines immediately above `declaration`. "Carrying
 * the comment" means the comment sits AT the constant. A matching string somewhere else
 * in the file does not count.
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

// broken

describe("brokenProofSatisfied", () => {
  test("should satisfy broken proof when a failure_correlated signal is present", () => {
    expect(brokenProofSatisfied([failureCorrelated()], ruleSetV1())).toBe(true);
  });

  test("should NOT satisfy broken proof from a failure_uncorrelated signal", () => {
    const rules = ruleSetV1();

    // The whole of in one line: an exception the pipeline could not tie to a
    // preceding action inside the window is recorded honestly as uncorrelated, and is
    // then not proof of anything.
    expect(brokenProofSatisfied([failureUncorrelated()], rules)).toBe(false);

    // Uncorrelated exceptions do not accumulate into proof either. Three coincidences
    // are still coincidences; volume is not correlation.
    expect(
      brokenProofSatisfied(
        [failureUncorrelated(), failureUncorrelated(), failureUncorrelated()],
        rules,
      ),
    ).toBe(false);

    // And a correlated signal sitting beside uncorrelated ones still proves `broken`.
    // The exclusion is of the uncorrelated kind, not a poisoning of the whole signal
    // list.
    expect(brokenProofSatisfied([failureUncorrelated(), failureCorrelated()], rules)).toBe(true);
  });

  test("should name BROKEN_PROOF_SIGNALS_V1 as a versioned constant carrying the (a) blind-spot comment", async () => {
    const source = await Bun.file(`${import.meta.dir}/../../src/evidence/signals.ts`).text();
    const comment = commentBlockAbove(source, "export const BROKEN_PROOF_SIGNALS_V1");

    //  versioned. The name carries its version, and the v1 rule set wires this exact
    // constant. That is what makes the "admitting a new signal is a one-line addition
    // plus a version bump" true rather than claimed.
    expect(source).toContain("export const BROKEN_PROOF_SIGNALS_V1");
    expect(BROKEN_PROOF_SIGNALS_V1).toEqual(["failure_correlated"]);
    expect(ruleSetV1().brokenProofSignals).toBe(BROKEN_PROOF_SIGNALS_V1);

    //  the escalation lives in code. is the absent request: the silent no-op
    // save where nothing throws and no event fires. It is undetectable over the current
    // `events` schema. No `properties` column, no status code, no network-request
    // property, and this comment is the only place a future contributor meets that fact
    // before trusting the predicate. A test asserts it stays there.
    expect(comment).toContain("Known blind spot");
    expect(comment).toContain("absent request");
    expect(comment).toContain("properties");
    expect(comment).toContain("status code");
    expect(comment).toContain("network-request property");

    //  The constant is not decorative: every kind it lists is admitted by the
    // predicate. Without this, "one-line change" would be a comment rather than a
    // property of the code.
    for (const kind of BROKEN_PROOF_SIGNALS_V1) {
      expect(brokenProofSatisfied([signalOfKind(kind)], ruleSetV1())).toBe(true);
    }
  });

  test("should downgrade a broken claim with struggle signals but no failure signal to confusing", () => {
    const rules = ruleSetV1();
    // A user who tried three times and never saw an exception. We can prove they
    // struggled; we cannot prove anything broke.
    const signals = [
      struggle(rules.struggleRepeatedAttemptMin),
      struggle(rules.struggleRepeatedAttemptMin),
    ];

    // This file asserts the predicate pair that produces the downgrade. The `broken`
    // rung fails, the `confusing` rung it steps to succeeds. The descent itself
    // (DOWNGRADE_PATH, the trace) is gate.test.ts's subject.
    expect(brokenProofSatisfied(signals, rules)).toBe(false);
    expect(confusingProofSatisfied(signals, rules)).toBe(true);
  });
});

// confusing

describe("confusingProofSatisfied", () => {
  test("should satisfy confusing proof when a struggle signal is present", () => {
    const rules = ruleSetV1();

    // Inclusive at exactly the threshold. Fail direction is carried by the magnitude.
    // "two visits to a path is navigation; three is a pattern", never by boundary
    // strictness.
    expect(confusingProofSatisfied([struggle(rules.struggleRepeatedAttemptMin)], rules)).toBe(true);
    expect(confusingProofSatisfied([struggle(rules.struggleRepeatedAttemptMin + 1)], rules)).toBe(
      true,
    );

    // The complement, so the test cannot pass against a predicate that returns true for
    // everything: one attempt below the minimum is not a struggle.
    expect(confusingProofSatisfied([struggle(rules.struggleRepeatedAttemptMin - 1)], rules)).toBe(
      false,
    );

    // No signal at all proves nothing.
    expect(confusingProofSatisfied([], rules)).toBe(false);
  });

  // / (Wave 7). The assertion for this direction already existed above, as the positive
  // test's own negative control, and it stays there, because a positive test keeping
  // its complement is what stops it passing against a predicate that returns `true` for
  // everything.
  //
  // What did not exist was a test whose name states the direction. That is the whole of
  // the requirement here: a reader scanning this suite, or the coverage map in
  // `coverage.test.ts` scanning it mechanically, must be able to see which way
  // `struggleRepeatedAttemptMin` fails without opening the file and reading the
  // assertions inside a test called "should satisfy…".
  test("should not satisfy confusing proof below struggleRepeatedAttemptMin", () => {
    const rules = ruleSetV1();
    const belowMinimum = rules.struggleRepeatedAttemptMin - 1;

    // The near miss must be a real revisit, or this degenerates into the single-attempt
    // case and stops testing the boundary at all.
    expect(belowMinimum).toBeGreaterThanOrEqual(2);

    // Fail direction: Under-detect. "Two visits to a path is navigation; three is a
    // pattern", so one below the minimum is not proof of confusion, and the consequence
    // is deliberate: a `confusing` claim with no proof hits the floor and is dropped.
    // Silence, not a softer claim.
    expect(confusingProofSatisfied([struggle(belowMinimum)], rules)).toBe(false);
    expect(confusingProofSatisfied([struggle(1)], rules)).toBe(false);

    // Sub-threshold struggles do not accumulate into proof either. Three people each
    // glancing at a page twice is not one person stuck on it, the same per-session
    // reading `funnel-dropoff.test.ts` pins on the producing side.
    expect(
      confusingProofSatisfied(
        [struggle(belowMinimum), struggle(belowMinimum), struggle(belowMinimum)],
        rules,
      ),
    ).toBe(false);

    // Non-vacuity, and the inclusive half: the same predicate, the same signal kind,
    // one attempt higher, does fire. So every `false` above is this magnitude holding,
    // never a predicate that rejects struggle signals outright. (the minimum gates the
    // `repeated_attempt` subkind only, which is what `struggle` builds.)
    expect(confusingProofSatisfied([struggle(rules.struggleRepeatedAttemptMin)], rules)).toBe(true);
  });

  // The cohort half.
  //
  // Why a second magnitude exists at all. `attempts` is a per-session maximum over
  // every kept session at the surface, so as an aggregate predicate it is monotonically
  // increasing in corpus size: at `DETECTOR_CORPUS_MAX_SESSIONS`, one session
  // revisiting a comparison page three times would set `struggle` for the whole
  // surface. The predicate would then fire on "at least one session came back". A
  // superset of its target, the conflation this sprint exists to prevent, and it would
  // do so at the single gate between drop-off arithmetic and a delivered finding,
  // because `struggle` is `confusing`'s only proof and `confusing` is the only class a
  // T1 detector can carry through the gate.
  test("should not satisfy confusing proof below struggleMinStrugglingSessions", () => {
    const rules = ruleSetV1();
    const outlier = rules.struggleMinStrugglingSessions - 1;

    // The near miss must be a real cohort, or this degenerates into the no-struggle
    // case and stops testing the boundary at all.
    expect(outlier).toBeGreaterThanOrEqual(1);

    // The outlier, at every per-session depth including a dramatic one. The magnitude a
    // founder reads (`attempts`) may be as loud as we like; the number of people it
    // happened to is not enough, and that is the one that decides. Fail direction:
    // Under-detect, the claim then hits the floor and is dropped. Silence, not a softer
    // claim.
    expect(
      confusingProofSatisfied([struggle(rules.struggleRepeatedAttemptMin, outlier)], rules),
    ).toBe(false);
    expect(
      confusingProofSatisfied([struggle(rules.struggleRepeatedAttemptMin * 10, outlier)], rules),
    ).toBe(false);

    // Nor do several sub-threshold cohorts accumulate into one. Each signal is its own
    // surface's claim; volume across signals is not a cohort.
    expect(
      confusingProofSatisfied(
        [
          struggle(rules.struggleRepeatedAttemptMin, outlier),
          struggle(rules.struggleRepeatedAttemptMin, outlier),
          struggle(rules.struggleRepeatedAttemptMin, outlier),
        ],
        rules,
      ),
    ).toBe(false);

    // Non-vacuity, and the inclusive half: the same predicate, the same per-session
    // depth, one more struggling session, does fire. So every `false` above is this
    // magnitude holding, never a predicate that rejects struggle signals outright.
    expect(
      confusingProofSatisfied(
        [struggle(rules.struggleRepeatedAttemptMin, rules.struggleMinStrugglingSessions)],
        rules,
      ),
    ).toBe(true);
  });

  // .
  //
  // `backtrack` used to be admitted on kind alone (no magnitude gate at all) three
  // lines below a comment explaining why that must not happen. Users navigate back
  // constantly, so a single back-navigation fires on a superset of its target, and it
  // was admitted at any magnitude at the one gate between drop-off arithmetic and a
  // delivered finding. The only thing preventing a false `confusing` finding was that
  // no detector emits `backtrack` this sprint (ruling 18); "no producer" is not a
  // guard, and has attaching a model to `ProposedClaim`.
  //
  // Fail direction: Under-detect. When a real producer exists, / may admit it
  // deliberately with its own calibrated magnitude gate.
  test("should not satisfy confusing proof from a backtrack signal at any magnitude", () => {
    const rules = ruleSetV1();

    for (const attempts of [0, 1, rules.struggleRepeatedAttemptMin, 99]) {
      expect(confusingProofSatisfied([backtrack(attempts)], rules)).toBe(false);
    }

    // Nor by accumulation, and not beside an unrelated signal either.
    expect(confusingProofSatisfied([backtrack(9), backtrack(9), backtrack(9)], rules)).toBe(false);
    expect(confusingProofSatisfied([backtrack(9), cleanExit()], rules)).toBe(false);

    // Non-vacuity: the same kind, the other subkind, at the same cohort, does prove
    // `confusing`. So every `false` above is the subkind being refused, never a
    // predicate that rejects struggle signals outright.
    expect(confusingProofSatisfied([struggle(rules.struggleRepeatedAttemptMin)], rules)).toBe(true);

    // And ruling 19 is unchanged. The half that must not be weakened. `backtrack`
    // proves nothing and still disqualifies `changed_mind`, at any magnitude, because
    // that class's proof is the absence of everything and a back-navigation is still
    // something happening. "Proves nothing" and "shows nothing happened" are different
    // statements.
    expect(changedMindProofSatisfied([cleanExit(), backtrack(1)], rules)).toBe(false);
  });
});

// changed_mind, the class whose proof is the absence of everything

describe("changedMindProofSatisfied", () => {
  test("should satisfy changed_mind proof only when clean_exit is present AND no failure and no struggle signal exist", () => {
    const rules = ruleSetV1();

    // The presence half.
    expect(changedMindProofSatisfied([cleanExit()], rules)).toBe(true);

    // The absence half, which is the load-bearing one and which the signal list cannot
    // express. A list can only say what must be present. Each case below carries
    // `clean_exit`, so anything other than `false` means the absence requirement is not
    // being enforced in the predicate.
    expect(changedMindProofSatisfied([cleanExit(), failureCorrelated()], rules)).toBe(false);
    expect(changedMindProofSatisfied([cleanExit(), failureUncorrelated()], rules)).toBe(false);
    expect(
      changedMindProofSatisfied([cleanExit(), struggle(rules.struggleRepeatedAttemptMin)], rules),
    ).toBe(false);

    // And the presence half is still required: absence alone is not proof.
    expect(changedMindProofSatisfied([], rules)).toBe(false);
  });

  // At the magnitude that matters
  //
  // Fail direction: Under-detect toward `drop`. A struggle signal of any subkind at any
  // magnitude blocks `changed_mind`.
  //
  // Why this test exists separately, and why the case above does not cover it. The test
  // above feeds a struggle at exactly `struggleRepeatedAttemptMin`. A magnitude strong
  // enough to prove `confusing` on its own. So it passes whether the disqualification
  // is kind-level (correct, ruling 19) or magnitude-level (wrong). The distinction only
  // becomes visible below the threshold.
  //
  // The regression it guards: routing the disqualification through
  // `anySignalProves(signals, ["struggle"], ruleSet)`, which is magnitude-gated, reads
  // naturally, and looks like a tidy reuse of the helper the other two predicates use.
  // That change would let a session with one or two visible repeated attempts pass as
  // `changed_mind`: the product telling a founder "they simply moved on" about a user
  // who was visibly struggling. `changed_mind` is the most product-flattering class
  // there is, and its proof is the absence of everything, so a sub-threshold struggle
  // is still evidence that something happened, which is the whole claim.
  test("should block changed_mind on a struggle signal of any kind at any magnitude", () => {
    const rules = ruleSetV1();

    // Non-vacuity. Without a struggle present the predicate is satisfied, so every
    // `false` below is the struggle doing the work and not a fixture that fails for
    // some unrelated reason.
    expect(changedMindProofSatisfied([cleanExit()], rules)).toBe(true);

    //  sub-threshold `repeated_attempt`, every magnitude below the minimum down to
    // zero. Each is too weak to prove `confusing` (asserted directly) and each must
    // still block `changed_mind`.
    for (let attempts = 0; attempts < rules.struggleRepeatedAttemptMin; attempts += 1) {
      const weak = struggle(attempts);

      // The magnitude really is sub-threshold: this signal cannot prove `confusing`. If
      // this ever goes true the loop is testing nothing.
      expect(confusingProofSatisfied([weak], rules)).toBe(false);

      // ...and yet it blocks the flattering class.
      expect(changedMindProofSatisfied([cleanExit(), weak], rules)).toBe(false);
    }

    //  The `backtrack` subkind, which has no producer this sprint (ruling
    // 18) and is admitted on kind alone. It must block regardless of magnitude,
    //  including at zero attempts, where any magnitude gate would wave it through.
    expect(changedMindProofSatisfied([cleanExit(), backtrack(0)], rules)).toBe(false);
    expect(changedMindProofSatisfied([cleanExit(), backtrack(1)], rules)).toBe(false);
    expect(
      changedMindProofSatisfied([cleanExit(), backtrack(rules.struggleRepeatedAttemptMin)], rules),
    ).toBe(false);
  });
});

// instrumentation

describe("instrumentationProofSatisfied", () => {
  test("should satisfy instrumentation proof when the rate crosses instrumentationDropRatio", () => {
    const rules = ruleSetV1();

    // Comfortably clear of the expected-count floor, so this test isolates the ratio
    // gate and nothing else.
    const expectedNumerator = rules.instrumentationMinExpected * 2;
    // The ratio is an integer percent, so the boundary is exact integer
    // arithmetic, `observed * 100 <= dropRatioPercent * expected`, never `observed /
    // expected >= 0.2`, which is ulp-fragile.
    const atBoundary = (expectedNumerator * rules.instrumentationDropRatioPercent) / 100;

    // Inclusive: exactly at the ratio fires.
    expect(instrumentationProofSatisfied([rateDrop(atBoundary, expectedNumerator)], rules)).toBe(
      true,
    );

    // A collapse well past the ratio fires too.
    expect(instrumentationProofSatisfied([rateDrop(0, expectedNumerator)], rules)).toBe(true);

    // One session the safe side of the boundary does not fire. The complement that
    // stops this passing against an always-true predicate.
    expect(
      instrumentationProofSatisfied([rateDrop(atBoundary + 1, expectedNumerator)], rules),
    ).toBe(false);
  });

  test("should not satisfy instrumentation proof below instrumentationMinExpected", () => {
    const rules = ruleSetV1();

    // The most extreme ratio there is (the event stopped firing entirely) on an
    // expected baseline one session below the floor. It must still not fire. Fail
    // direction: Under-detect. "This event stopped firing" is indistinguishable from
    // "this event was always rare" down here, and a false instrumentation claim burns
    // the credibility the MVP exists to test.
    expect(
      instrumentationProofSatisfied([rateDrop(0, rules.instrumentationMinExpected - 1)], rules),
    ).toBe(false);

    // Inclusive at the floor: exactly `instrumentationMinExpected` is a large enough
    // baseline, so the boundary is the magnitude's job, not the comparison operator's.
    expect(
      instrumentationProofSatisfied([rateDrop(0, rules.instrumentationMinExpected)], rules),
    ).toBe(true);
  });
});

// —: the predicates read their signal lists off the parameter

describe("predicates read the rule-set parameter, never the module constant", () => {
  test("should follow the rule set it is handed when its proof-signal list differs from v1", () => {
    // A hypothetical rule set that admits the uncorrelated kind (this is exactly the
    // one-line edit promises, and exactly the edit That decision says needs first-party
    // capture before it is safe). If the predicate reached for
    // `BROKEN_PROOF_SIGNALS_V1` directly instead of reading its parameter, both
    // assertions below would come out the v1 way and this test would catch it.
    //
    // Stamped with a synthetic version, not `2`. This once read `version: 2` on the
    // reasoning that it is "honestly not v1". True only while no v2 existed. shipped
    // `RULE_SET_V2` and registered it at `THRESHOLD_RULE_SETS.get`, so stamping `2`
    // here would mint a third distinct rule set claiming to be version 2. That is the
    // identity fork the v2 bump was made to prevent: the moment anything persists
    // `thresholdRuleSetVersion`, a replay through the registry would reproduce a
    // decision this rule set never made. A negative version collides with nothing
    // registered today and with no future bump either, which `3` could not promise.
    const admitsUncorrelated: ThresholdRuleSet = {
      ...ruleSetV1(),
      version: SYNTHETIC_RULE_SET_VERSION,
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

// -- confidenceBasisForPass
//
// The assembler's ranking derivation, defined here beside the predicate maths it must
// agree with. These tests pin the vocabulary: `at_threshold` is "every proving
// magnitude sits exactly at its inclusive boundary", and one signal clearing with room
// is enough to say `threshold_met`.
describe("confidenceBasisForPass", () => {
  test("reports at_threshold when the proving struggle sits exactly at both minimums", () => {
    const rules = ruleSetV1();
    const signal = struggle(rules.struggleRepeatedAttemptMin, rules.struggleMinStrugglingSessions);

    expect(confidenceBasisForPass([signal], "confusing", rules)).toBe("at_threshold");
  });

  test("reports at_threshold when EITHER struggle magnitude is at its boundary, since one fewer would not fire", () => {
    const rules = ruleSetV1();
    // Attempts at the minimum, cohort clear of it: the claim is still boundary-fragile
    // in one dimension, and may rank it lower.
    const attemptsAtBoundary = struggle(
      rules.struggleRepeatedAttemptMin,
      STRUGGLING_SESSIONS_ABOVE_MINIMUM,
    );

    expect(confidenceBasisForPass([attemptsAtBoundary], "confusing", rules)).toBe("at_threshold");
  });

  test("reports threshold_met when the proving signal clears both minimums with room", () => {
    const rules = ruleSetV1();
    const signal = struggle(
      rules.struggleRepeatedAttemptMin + 1,
      rules.struggleMinStrugglingSessions + 1,
    );

    expect(confidenceBasisForPass([signal], "confusing", rules)).toBe("threshold_met");
  });

  test("reports threshold_met when ANY proving signal clears with room beside one at the boundary", () => {
    const rules = ruleSetV1();
    const atBoundary = struggle(
      rules.struggleRepeatedAttemptMin,
      rules.struggleMinStrugglingSessions,
    );
    const clear = struggle(
      rules.struggleRepeatedAttemptMin + 2,
      rules.struggleMinStrugglingSessions + 2,
    );

    expect(confidenceBasisForPass([atBoundary, clear], "confusing", rules)).toBe("threshold_met");
  });

  test("reports threshold_met for presence-only proof, which has no boundary to sit at", () => {
    const rules = ruleSetV1();

    expect(confidenceBasisForPass([cleanExit()], "changed_mind", rules)).toBe("threshold_met");
  });

  test("reports at_threshold for a broken pass whose correlated cohort is exactly the minimum", () => {
    const rules = ruleSetV1();
    // `failureCorrelated` carries numerator 3. Exactly `errorMinAffectedSessions` at
    // v1, the audit C-1 cohort gate's boundary.
    expect(rules.errorMinAffectedSessions).toBe(3);

    expect(confidenceBasisForPass([failureCorrelated()], "broken", rules)).toBe("at_threshold");
  });

  test("ignores a signal of an unadmitted kind when deriving the basis, as the predicates do", () => {
    const rules = ruleSetV1();
    // The struggle proves `confusing` at its boundary; the uncorrelated failure is not
    // admitted proof of `confusing` and must not move the basis, exactly as it moves no
    // predicate.
    const signals = [
      struggle(rules.struggleRepeatedAttemptMin, rules.struggleMinStrugglingSessions),
      failureUncorrelated(),
    ];

    expect(confidenceBasisForPass(signals, "confusing", rules)).toBe("at_threshold");
  });
});
