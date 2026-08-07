import { z } from "zod";

import { measuredCountSchema } from "../counts/measured-count";
import { analysisWindowSchema, claimSubjectSchema, detectorCoverageSchema } from "../detect/types";
import { isReachableClass } from "../evidence/gate";
import { evidenceSignalSchema } from "../evidence/signals";
import { downgradeTraceSchema } from "../evidence/trace";
import type { DowngradeTrace } from "../evidence/trace";
import { detectorNameSchema, findingClassSchema } from "../rules/types";
import type { FindingClass } from "../rules/types";

export { proposedClaimSchema } from "../evidence/gate";
export type { ProposedClaim } from "../evidence/gate";

export const confidenceBasisSchema = z.enum(["threshold_met", "at_threshold", "below_threshold"]);
export type ConfidenceBasis = z.infer<typeof confidenceBasisSchema>;

export const rankingInputsSchema = z.object({
  sampleSize: measuredCountSchema,
  confidenceBasis: confidenceBasisSchema,
});
export type RankingInputs = z.infer<typeof rankingInputsSchema>;

export const candidateFindingSchema = z
  .object({
    detector: detectorNameSchema,
    claimedClass: findingClassSchema,
    finalClass: findingClassSchema,
    trace: downgradeTraceSchema,
    counts: z.array(measuredCountSchema).min(1),
    timeframe: analysisWindowSchema,

    // Defaulted, not required: a candidate written before this key existed still parses,
    // and a candidate genuinely without signals renders through FIX_SPEC_NO_EVIDENCE_TEMPLATE.
    signals: z.array(evidenceSignalSchema).default([]),

    claimSubject: claimSubjectSchema,

    surface: z.string().min(1),

    surfaceNormalisationVersion: z.number().int().nullable(),

    evidenceShape: z.string().min(1),
    evidenceShapeVersion: z.number().int().positive(),

    thresholdRuleSetVersion: z.number().int().positive(),
    ranking: rankingInputsSchema,

    coverage: detectorCoverageSchema,
  })
  .refine((candidate) => isReachableClass(candidate.claimedClass, candidate.finalClass), {
    message:
      "a candidate's final class must be reachable from its claimed class by the downgrade path",
    path: ["finalClass"],
  })
  // Reachability alone lets `finalClass: claim.claimedClass` past — one token's difference from
  // `outcome.finalClass` at a call site — while the trace says the class was never proved. The
  // trace is the record of what the gate concluded, so the last entry has to be that conclusion.
  .refine((candidate) => lastTraceEntryConcludes(candidate.trace, candidate.finalClass), {
    message:
      "a candidate's trace must end on its final class, satisfied: the trace is the record of " +
      "what the gate concluded, and a candidate whose trace ends unsatisfied was not proved",
    path: ["trace"],
  });

function lastTraceEntryConcludes(trace: DowngradeTrace, finalClass: FindingClass): boolean {
  const concluding = trace.at(-1);

  return concluding !== undefined && concluding.class === finalClass && concluding.satisfied;
}

export type CandidateFinding = z.infer<typeof candidateFindingSchema>;
