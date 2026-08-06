import { rateOf } from "../counts/measured-count";
import type { MeasuredCount } from "../counts/measured-count";
import { PERCENT_SCALE } from "../counts/percent";
import type { FindingClass, ThresholdRuleSet } from "../rules/types";
import type { EvidenceSignal, EvidenceSignalKind } from "./signals";

export const PROOF_PREDICATE_VERSION = 1;

type InstrumentationDrop = "below_ratio" | "at_ratio" | "above_ratio" | "no_rate";

// Comparing the two numerators assumes they share a denominator, and `expected` is by
// definition measured over a different window with a different `kept` — so 15 of 50 (30%)
// against an expected 100 of 500 (20%) reported that an event had almost stopped arriving
// on a week its rate had risen by half (B-022). Rates are what the sentence claims, so
// rates are what the threshold reads, and a rate that cannot be computed proves nothing.
function instrumentationDrop(
  observed: MeasuredCount,
  expected: MeasuredCount,
  ruleSet: ThresholdRuleSet,
): InstrumentationDrop {
  const observedRate = rateOf(observed);
  const expectedRate = rateOf(expected);
  if (observedRate.kind === "no_rate" || expectedRate.kind === "no_rate") return "no_rate";

  const ceiling = (ruleSet.instrumentationDropRatioPercent * expectedRate.value) / PERCENT_SCALE;
  if (observedRate.value === ceiling) return "at_ratio";

  return observedRate.value < ceiling ? "below_ratio" : "above_ratio";
}

function isAtOrBelowRatio(drop: InstrumentationDrop): boolean {
  return drop === "below_ratio" || drop === "at_ratio";
}

function magnitudeSatisfied(signal: EvidenceSignal, ruleSet: ThresholdRuleSet): boolean {
  switch (signal.kind) {
    case "struggle":
      switch (signal.subkind) {
        case "repeated_attempt":
          return (
            signal.attempts >= ruleSet.struggleRepeatedAttemptMin &&
            signal.strugglingSessions.numerator >= ruleSet.struggleMinStrugglingSessions
          );
        case "backtrack":
          return false;
        case "rage_click":
          return (
            signal.attempts >= ruleSet.struggleRageClickMin &&
            signal.strugglingSessions.numerator >= ruleSet.struggleObservedMinSessions
          );
        case "dead_click":
          return (
            signal.attempts >= ruleSet.struggleDeadClickMin &&
            signal.strugglingSessions.numerator >= ruleSet.struggleObservedMinSessions
          );
        case "field_abandoned":
          return (
            signal.attempts >= ruleSet.struggleFieldAbandonedMin &&
            signal.strugglingSessions.numerator >= ruleSet.struggleObservedMinSessions
          );
        case "field_refocus":
          return (
            signal.attempts >= ruleSet.struggleFieldRefocusMin &&
            signal.strugglingSessions.numerator >= ruleSet.struggleObservedMinSessions
          );
        case "scroll_back":
          return (
            signal.attempts >= ruleSet.struggleScrollBackMin &&
            signal.strugglingSessions.numerator >= ruleSet.struggleObservedMinSessions
          );
      }
    case "instrumentation_rate_drop":
      return (
        signal.expected.numerator >= ruleSet.instrumentationMinExpected &&
        isAtOrBelowRatio(instrumentationDrop(signal.observed, signal.expected, ruleSet))
      );
    case "failure_correlated":
      return signal.correlatedSessions.numerator >= ruleSet.errorMinAffectedSessions;
    case "failure_uncorrelated":
    case "clean_exit":
      return true;
  }
}

function anySignalProves(
  signals: readonly EvidenceSignal[],
  admittedKinds: readonly EvidenceSignalKind[],
  ruleSet: ThresholdRuleSet,
): boolean {
  return signals.some(
    (signal) => admittedKinds.includes(signal.kind) && magnitudeSatisfied(signal, ruleSet),
  );
}

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

function atInclusiveBoundary(signal: EvidenceSignal, ruleSet: ThresholdRuleSet): boolean {
  switch (signal.kind) {
    case "struggle":
      switch (signal.subkind) {
        case "repeated_attempt":
          return (
            signal.attempts === ruleSet.struggleRepeatedAttemptMin ||
            signal.strugglingSessions.numerator === ruleSet.struggleMinStrugglingSessions
          );
        case "backtrack":
          return false;
        case "rage_click":
          return (
            signal.attempts === ruleSet.struggleRageClickMin ||
            signal.strugglingSessions.numerator === ruleSet.struggleObservedMinSessions
          );
        case "dead_click":
          return (
            signal.attempts === ruleSet.struggleDeadClickMin ||
            signal.strugglingSessions.numerator === ruleSet.struggleObservedMinSessions
          );
        case "field_abandoned":
          return (
            signal.attempts === ruleSet.struggleFieldAbandonedMin ||
            signal.strugglingSessions.numerator === ruleSet.struggleObservedMinSessions
          );
        case "field_refocus":
          return (
            signal.attempts === ruleSet.struggleFieldRefocusMin ||
            signal.strugglingSessions.numerator === ruleSet.struggleObservedMinSessions
          );
        case "scroll_back":
          return (
            signal.attempts === ruleSet.struggleScrollBackMin ||
            signal.strugglingSessions.numerator === ruleSet.struggleObservedMinSessions
          );
      }
    case "failure_correlated":
      return signal.correlatedSessions.numerator === ruleSet.errorMinAffectedSessions;
    case "instrumentation_rate_drop":
      return (
        instrumentationDrop(signal.observed, signal.expected, ruleSet) === "at_ratio" ||
        signal.expected.numerator === ruleSet.instrumentationMinExpected
      );
    case "failure_uncorrelated":
    case "clean_exit":
      return false;
  }
}

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

const CHANGED_MIND_DISQUALIFYING_KINDS: ReadonlySet<EvidenceSignalKind> = new Set([
  "failure_correlated",
  "failure_uncorrelated",
  "struggle",
]);

export type ProofPredicate = {
  readonly name: string;
  readonly version: number;
  readonly satisfied: (signals: readonly EvidenceSignal[], ruleSet: ThresholdRuleSet) => boolean;
};

export function brokenProofSatisfied(
  signals: readonly EvidenceSignal[],
  ruleSet: ThresholdRuleSet,
): boolean {
  return anySignalProves(signals, ruleSet.brokenProofSignals, ruleSet);
}

export function confusingProofSatisfied(
  signals: readonly EvidenceSignal[],
  ruleSet: ThresholdRuleSet,
): boolean {
  return anySignalProves(signals, ruleSet.confusingProofSignals, ruleSet);
}

export function changedMindProofSatisfied(
  signals: readonly EvidenceSignal[],
  ruleSet: ThresholdRuleSet,
): boolean {
  const disqualified = signals.some((signal) => CHANGED_MIND_DISQUALIFYING_KINDS.has(signal.kind));
  if (disqualified) return false;
  return anySignalProves(signals, ruleSet.changedMindProofSignals, ruleSet);
}

export function instrumentationProofSatisfied(
  signals: readonly EvidenceSignal[],
  ruleSet: ThresholdRuleSet,
): boolean {
  return anySignalProves(signals, ruleSet.instrumentationProofSignals, ruleSet);
}

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
