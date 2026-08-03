import type { DetectorCandidate, DetectorResult } from "../detect/types";
import { evaluate } from "../evidence/gate";
import { confidenceBasisForPass } from "../evidence/predicates";
import type { DowngradeTrace } from "../evidence/trace";
import type { ThresholdRuleSet } from "../rules/types";
import { candidateFindingSchema } from "./candidate";
import type { CandidateFinding } from "./candidate";
import { EVIDENCE_SHAPE_VERSION, evidenceShape } from "./evidence-shape";

export type RejectedCandidate = {
  readonly detector: DetectorCandidate["detector"];
  readonly surface: string;
  readonly trace: DowngradeTrace;
};

export type AssembledCandidates = {
  readonly candidates: readonly CandidateFinding[];

  readonly rejected: readonly RejectedCandidate[];
};

export function assembleCandidates(
  results: readonly DetectorResult[],
  ruleSet: ThresholdRuleSet,
): AssembledCandidates {
  const candidates: CandidateFinding[] = [];
  const rejected: RejectedCandidate[] = [];

  for (const result of results) {
    for (const candidate of result.candidates) {
      const outcome = evaluate(
        {
          detector: candidate.detector,
          claimedClass: candidate.claimedClass,
          surface: candidate.surface,
          surfaceNormalisationVersion: candidate.surfaceNormalisationVersion,
          signals: candidate.signals,
          counts: candidate.counts,
          timeframe: candidate.timeframe,
          coverage: candidate.coverage,
        },
        ruleSet,
      );

      if (outcome.kind === "drop") {
        rejected.push({
          detector: candidate.detector,
          surface: candidate.surface,
          trace: outcome.trace,
        });
        continue;
      }

      candidates.push(
        candidateFindingSchema.parse({
          detector: candidate.detector,
          claimedClass: candidate.claimedClass,
          finalClass: outcome.finalClass,
          trace: outcome.trace,
          counts: candidate.counts,
          timeframe: candidate.timeframe,
          signals: candidate.signals,
          claimSubject: candidate.claimSubject,
          surface: candidate.surface,
          surfaceNormalisationVersion: candidate.surfaceNormalisationVersion,
          evidenceShape: evidenceShape(
            {
              detector: candidate.detector,
              surface: candidate.surface,
              surfaceNormalisationVersion: candidate.surfaceNormalisationVersion,
              signals: candidate.signals,
              symptomClass: outcome.finalClass,
            },
            EVIDENCE_SHAPE_VERSION,
          ),
          evidenceShapeVersion: EVIDENCE_SHAPE_VERSION,
          thresholdRuleSetVersion: ruleSet.version,
          ranking: {
            sampleSize: candidate.counts[0],
            confidenceBasis: confidenceBasisForPass(candidate.signals, outcome.finalClass, ruleSet),
          },
          coverage: candidate.coverage,
        }),
      );
    }
  }

  return { candidates, rejected };
}
