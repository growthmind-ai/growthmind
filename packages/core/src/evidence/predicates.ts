// The proof predicates — one per finding class (O-004 FR-12, FR-15, FR-19).
//
// Each is a set-membership check over its VERSIONED rule-set constant. That is
// what makes FR-19's "admitting a new signal is a one-line change" true rather
// than claimed: when BS-1(b) lands, the change is one array entry in
// `../evidence/signals.ts` plus a rule-set version bump — never a rewrite of
// the gate.
//
// EVERY predicate takes the rule set as a PARAMETER (D-14). None of them reads
// `CURRENT_THRESHOLD_RULE_SET`, and none of them imports a `*_PROOF_SIGNALS_V1`
// constant either — the only route to a signal list is the parameter, so
// `THRESHOLD_RULE_SETS.get(1)` reproduces a v1 verdict exactly after v2 lands.
// PL ruling 26: FR-8's "no numeric literal" targets UNNAMED literals in a
// predicate body — a NAMED constant is what it is asking for. The percent
// scale is arithmetic, not a threshold, so it cannot come from the rule set;
// it is imported from the one place `detect/funnel-dropoff.ts` reads it too,
// so the package's two integer-percent comparisons share a single scale.
import { PERCENT_SCALE } from "../counts/percent";
import type { FindingClass, ThresholdRuleSet } from "../rules/types";
import type { EvidenceSignal, EvidenceSignalKind } from "./signals";

/** Every predicate's version this sprint. Travels onto the trace entry so a
 * v2 predicate's verdict is never read as a v1 one. */
export const PROOF_PREDICATE_VERSION = 1;

/**
 * Does this signal clear the magnitude its own kind is gated on?
 *
 * Kind membership says a signal is the RIGHT SORT of evidence; this says it is
 * ENOUGH of it. Splitting the two is what keeps each predicate a plain
 * set-membership check over its rule-set list, so admitting a new kind stays a
 * one-line change (FR-19) rather than a new branch in four predicates.
 *
 * Only two kinds carry a magnitude at all; the rest are proof by existence.
 * Every comparison is INCLUSIVE (D-6) and every fail direction is UNDER-DETECT
 * (FR-9) — the magnitudes themselves live in the rule set, with their
 * rationale, and nothing here hard-codes a number.
 *
 * One kind is refused OUTRIGHT rather than gated on a magnitude: the
 * `backtrack` subkind (PL ruling 36, at the case below). "Not enough of it" and
 * "not evidence at all" are different verdicts, and this function returns both.
 */
function magnitudeSatisfied(signal: EvidenceSignal, ruleSet: ThresholdRuleSet): boolean {
  switch (signal.kind) {
    case "struggle":
      // ── PL RULING 36 (binding): `backtrack` IS NOT ADMISSIBLE PROOF. ───────
      //
      // It stays in the union, typed and tested against constructed inputs, and
      // it REMAINS a `changed_mind` disqualifier at any magnitude (ruling 19,
      // enforced kind-level in `CHANGED_MIND_DISQUALIFYING_KINDS` below, which
      // never consults this function). What it may no longer do is SATISFY a
      // class.
      //
      // Ruling 18 gave the reason and the previous code then contradicted it:
      // users navigate back constantly, so a single back-navigation fires on a
      // SUPERSET of its target — the D10 conflation this gate exists to
      // prevent — and returning `true` here admitted exactly that, at any
      // magnitude, including one. The only thing standing between that and a
      // false `confusing` finding was that no detector emits `backtrack` this
      // sprint. "No producer" is not a guard: ESC-6 has O-005 attaching a MODEL
      // to `ProposedClaim`, and a model can emit anything in the union.
      //
      // Strictly UNDER-DETECT. When a real producer exists, O-005/O-006 may
      // admit it DELIBERATELY, with its own calibrated magnitude gate.
      if (signal.subkind !== "repeated_attempt") return false;

      // TWO magnitudes, both INCLUSIVE (D-6), both UNDER-DETECT (FR-9), both
      // arriving on the rule-set parameter (D-14):
      //  - `struggleRepeatedAttemptMin` — one session came back often enough
      //    for it to be a pattern rather than navigation (PER-SESSION);
      //  - `struggleMinStrugglingSessions` — enough separate sessions did for
      //    "people" to be the true word (COHORT).
      // The first alone is a maximum over an unbounded corpus, so it rises with
      // corpus size and at 500 sessions one outlier would carry the surface.
      // The second is what makes this predicate a claim about the SURFACE
      // rather than about how much data we happened to read.
      return (
        signal.attempts >= ruleSet.struggleRepeatedAttemptMin &&
        signal.strugglingSessions.numerator >= ruleSet.struggleMinStrugglingSessions
      );
    case "instrumentation_rate_drop":
      // PL ruling 20: compare NUMERATORS, exact integer arithmetic. This is
      // unambiguous by construction — `measuredCount` forces
      // `denominator === basis.kept`, so observed and expected always share a
      // denominator and the ratio of numerators IS the ratio of rates.
      // Integer percent, never float division: `0.2` is ulp-fragile at exactly
      // the boundary, scaling by `PERCENT_SCALE` is exact (PL ruling 1).
      return (
        signal.expected.numerator >= ruleSet.instrumentationMinExpected &&
        signal.observed.numerator * PERCENT_SCALE <=
          ruleSet.instrumentationDropRatioPercent * signal.expected.numerator
      );
    case "failure_correlated":
      // THE COHORT GATE for the product's strongest claim (O-004 audit C-1).
      // Previously unconditional `true`, so ONE correlated session satisfied
      // `broken` while the candidate reported the all-exceptions cohort — the
      // gate asserting "we could prove it failed" over a number that counted
      // sessions it had not proven anything about. Same shape ruling 31 fixed
      // for `struggle`, on the class where a wrong verdict costs most.
      return signal.correlatedSessions.numerator >= ruleSet.errorMinAffectedSessions;
    case "failure_uncorrelated":
    case "clean_exit":
      return true;
  }
}

/** Is any signal here both an ADMITTED kind and of sufficient magnitude? */
function anySignalProves(
  signals: readonly EvidenceSignal[],
  admittedKinds: readonly EvidenceSignalKind[],
  ruleSet: ThresholdRuleSet,
): boolean {
  return signals.some(
    (signal) => admittedKinds.includes(signal.kind) && magnitudeSatisfied(signal, ruleSet),
  );
}

/**
 * Which signal kinds the rule set admits as proof of `finalClass` — the same
 * lists the predicates read, resolved by class. Internal: the one consumer is
 * `confidenceBasisForPass` below, which must agree with the predicates about
 * what proved a class, and keeping the resolution in this file is what makes
 * that agreement a property of one diff rather than of two files staying in
 * sync (O-012, "one implementation reused").
 */
function admittedKindsFor(
  finalClass: FindingClass,
  ruleSet: ThresholdRuleSet,
): readonly EvidenceSignalKind[] {
  switch (finalClass) {
    case "broken":
      return ruleSet.brokenProofSignals;
    case "confusing":
      return ruleSet.confusingProofSignals;
    case "changed_mind":
      return ruleSet.changedMindProofSignals;
    case "instrumentation":
      return ruleSet.instrumentationProofSignals;
  }
}

/**
 * Is this PROVING signal sitting EXACTLY at an inclusive boundary (D-6)?
 *
 * Reads the SAME magnitudes `magnitudeSatisfied` gates on, in the same file,
 * so the two cannot drift apart silently: a threshold added to a predicate
 * without a boundary case here is visible in one diff. Callers only ever ask
 * this of a signal `magnitudeSatisfied` already accepted — for a presence-only
 * kind there is no boundary to sit at, so the answer is `false`.
 */
function atInclusiveBoundary(signal: EvidenceSignal, ruleSet: ThresholdRuleSet): boolean {
  switch (signal.kind) {
    case "struggle":
      if (signal.subkind !== "repeated_attempt") return false;
      return (
        signal.attempts === ruleSet.struggleRepeatedAttemptMin ||
        signal.strugglingSessions.numerator === ruleSet.struggleMinStrugglingSessions
      );
    case "failure_correlated":
      return signal.correlatedSessions.numerator === ruleSet.errorMinAffectedSessions;
    case "instrumentation_rate_drop":
      // The same exact-integer comparison `magnitudeSatisfied` makes, at
      // equality — plus the minimum-baseline boundary, which is inclusive too.
      return (
        signal.observed.numerator * PERCENT_SCALE ===
          ruleSet.instrumentationDropRatioPercent * signal.expected.numerator ||
        signal.expected.numerator === ruleSet.instrumentationMinExpected
      );
    case "failure_uncorrelated":
    case "clean_exit":
      return false;
  }
}

/**
 * The confidence basis for a claim the gate PASSED at `finalClass` (O-012).
 *
 * `at_threshold` when every signal that proves the class sits exactly at an
 * inclusive boundary (the D-6 case `confidenceBasisSchema` names so O-006 can
 * rank it lower); `threshold_met` the moment any proving signal clears its
 * magnitudes with room. Presence-only proof (a `clean_exit`) has no boundary
 * to sit at and is therefore `threshold_met`.
 *
 * Returns the literal union rather than importing `ConfidenceBasis`: that type
 * lives in `../findings/candidate.ts`, which imports this package's gate — an
 * import from here back into findings would be the package-internal cycle the
 * candidate module's own header warns against. The literals are assignable to
 * `ConfidenceBasis`, and `candidateFindingSchema.parse` re-checks them at the
 * assembler's boundary.
 *
 * `below_threshold` is NOT produced here, by construction: this function is
 * only defined for a PASS, and a passed class had at least one proving signal.
 * That arm of the enum exists for provenance rows other producers may emit.
 */
export function confidenceBasisForPass(
  signals: readonly EvidenceSignal[],
  finalClass: FindingClass,
  ruleSet: ThresholdRuleSet,
): "threshold_met" | "at_threshold" {
  const admitted = admittedKindsFor(finalClass, ruleSet);
  const proving = signals.filter(
    (signal) => admitted.includes(signal.kind) && magnitudeSatisfied(signal, ruleSet),
  );

  const allAtBoundary =
    proving.length > 0 && proving.every((signal) => atInclusiveBoundary(signal, ruleSet));

  return allAtBoundary ? "at_threshold" : "threshold_met";
}

/**
 * The kinds whose mere PRESENCE disqualifies `changed_mind`, at any magnitude.
 *
 * Not a rule-set member, deliberately: every `ThresholdRuleSet` field is an
 * under-detect assertion gate (PL ruling 4), and this is the opposite — a
 * widening of it would ADMIT more `changed_mind` claims, which is the one
 * direction this sprint refuses to make configurable.
 */
const CHANGED_MIND_DISQUALIFYING_KINDS: ReadonlySet<EvidenceSignalKind> = new Set([
  "failure_correlated",
  "failure_uncorrelated",
  "struggle",
]);

/** A named, versioned proof predicate. The name and the version appear in the
 * gate's output (FR-12). */
export type ProofPredicate = {
  readonly name: string;
  readonly version: number;
  readonly satisfied: (signals: readonly EvidenceSignal[], ruleSet: ThresholdRuleSet) => boolean;
};

/**
 * `broken` — "a failed or absent request correlated to the action".
 *
 * Satisfied by a signal whose kind is in `ruleSet.brokenProofSignals`, which
 * is `["failure_correlated"]` at v1. A `failure_uncorrelated` signal does NOT
 * satisfy it (ES-13): an exception that could not be tied to the user's action
 * is not evidence that the user's action broke, and admitting it is exactly
 * the over-permissive predicate the PRD names as a High risk.
 *
 * The ABSENT half of "failed or absent request" is out of reach over the
 * current schema — see the KNOWN BLIND SPOT comment at
 * `BROKEN_PROOF_SIGNALS_V1` in `./signals.ts`, and ESC-1 in the ADD.
 */
export function brokenProofSatisfied(
  signals: readonly EvidenceSignal[],
  ruleSet: ThresholdRuleSet,
): boolean {
  return anySignalProves(signals, ruleSet.brokenProofSignals, ruleSet);
}

/**
 * `confusing` — "hesitation, backtracking, or repeated attempts at one
 * decision point".
 *
 * Satisfied by a signal whose kind is in `ruleSet.confusingProofSignals` and
 * whose subkind is `repeated_attempt`, carrying BOTH
 * `attempts >= ruleSet.struggleRepeatedAttemptMin` (one session came back often
 * enough to be a pattern) and
 * `strugglingSessions.numerator >= ruleSet.struggleMinStrugglingSessions`
 * (enough sessions did for "people" to be the true word). Both INCLUSIVE (D-6),
 * both under-detect (FR-9).
 *
 * PL ruling 36: the `backtrack` subkind satisfies this predicate at NO
 * magnitude. It remains a `changed_mind` disqualifier (ruling 19) — see
 * `magnitudeSatisfied`.
 *
 * THIS IS THE SPRINT'S ONLY REACHABLE PASS. `funnel_dropoff` proposes
 * `confusing` and nothing else (ruling 13), `struggle` is `confusing`'s only
 * admitted proof, and a `broken` claim can only reach a founder by descending
 * here. Every magnitude above is load-bearing on whether this product speaks.
 */
export function confusingProofSatisfied(
  signals: readonly EvidenceSignal[],
  ruleSet: ThresholdRuleSet,
): boolean {
  return anySignalProves(signals, ruleSet.confusingProofSignals, ruleSet);
}

/**
 * `changed_mind` — "clean exit, no error, no struggle signal".
 *
 * Two halves, and the second is the load-bearing one. A signal whose kind is
 * in `ruleSet.changedMindProofSignals` must be PRESENT, **and** no failure
 * signal (correlated or not) and no struggle signal may exist. The ABSENCE
 * requirement is enforced HERE, in the predicate — a signal list can only say
 * what must be present, and this class's proof is mostly about what must not
 * be.
 *
 * The absence check is KIND-LEVEL, NOT THRESHOLD-LEVEL (PL ruling 19): a
 * struggle signal of any subkind at any magnitude blocks the class, even one
 * below `struggleRepeatedAttemptMin`. A sub-threshold struggle is too weak to
 * PROVE `confusing`, but it is still evidence that something happened — and
 * "nothing happened" is the entire claim here. Dropping is the safe direction
 * for the most product-flattering class there is.
 *
 * This predicate is reachable only for an ORIGINALLY PROPOSED `changed_mind`
 * (a model's claim, from O-005). No T1 detector may propose the class (D-9),
 * and FR-13B makes it unreachable as a cascade destination — so nothing in
 * this sprint produces one, by design.
 */
export function changedMindProofSatisfied(
  signals: readonly EvidenceSignal[],
  ruleSet: ThresholdRuleSet,
): boolean {
  const disqualified = signals.some((signal) => CHANGED_MIND_DISQUALIFYING_KINDS.has(signal.kind));
  if (disqualified) return false;
  return anySignalProves(signals, ruleSet.changedMindProofSignals, ruleSet);
}

/**
 * `instrumentation` — "a known event's firing rate crossing its own
 * threshold".
 *
 * Satisfied by a signal whose kind is in `ruleSet.instrumentationProofSignals`
 * whose observed count falls to or below `ruleSet.instrumentationDropRatioPercent`
 * percent of its expected count — INCLUSIVE (D-6) — and only when the expected
 * count is at least `ruleSet.instrumentationMinExpected` (fail direction:
 * under-detect — no rate claim on a tiny baseline). Both comparisons are on
 * NUMERATORS, in exact integer arithmetic (PL rulings 1 and 20); see
 * `magnitudeSatisfied` for why the numerator ratio is the rate ratio.
 *
 * ESC-3: this class HAS NO PRODUCER this sprint. Architecture §4.4 names one
 * ("detects when a known event stops firing"); it is a later sprint's work and
 * needs no change here. The class is built, typed, and tested against
 * constructed inputs — recorded in the ADD's Escalations, not only here, so it
 * does not read as a dead wire at the next review.
 */
export function instrumentationProofSatisfied(
  signals: readonly EvidenceSignal[],
  ruleSet: ThresholdRuleSet,
): boolean {
  return anySignalProves(signals, ruleSet.instrumentationProofSignals, ruleSet);
}

/**
 * The predicate for each class, keyed by class — what the gate's descent
 * looks up at each rung. A `Record` over the full union, so a class with no
 * predicate is a compile error rather than a runtime `undefined` (D9).
 */
export const PROOF_PREDICATES: Readonly<Record<FindingClass, ProofPredicate>> = {
  broken: {
    name: "broken_failure_correlated",
    version: PROOF_PREDICATE_VERSION,
    satisfied: brokenProofSatisfied,
  },
  confusing: {
    name: "confusing_struggle",
    version: PROOF_PREDICATE_VERSION,
    satisfied: confusingProofSatisfied,
  },
  changed_mind: {
    name: "changed_mind_clean_exit",
    version: PROOF_PREDICATE_VERSION,
    satisfied: changedMindProofSatisfied,
  },
  instrumentation: {
    name: "instrumentation_rate_drop",
    version: PROOF_PREDICATE_VERSION,
    satisfied: instrumentationProofSatisfied,
  },
};
