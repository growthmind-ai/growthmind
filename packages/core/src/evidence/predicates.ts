import { PERCENT_SCALE } from "../counts/percent";
import type { FindingClass, ThresholdRuleSet } from "../rules/types";
import type { EvidenceSignal, EvidenceSignalKind } from "./signals";

export const PROOF_PREDICATE_VERSION = 1;

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
        signal.observed.numerator * PERCENT_SCALE <=
          ruleSet.instrumentationDropRatioPercent * signal.expected.numerator
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
        signal.observed.numerator * PERCENT_SCALE ===
          ruleSet.instrumentationDropRatioPercent * signal.expected.numerator ||
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
