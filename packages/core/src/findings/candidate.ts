import { z } from "zod";

import { measuredCountSchema } from "../counts/measured-count";
import { analysisWindowSchema, claimSubjectSchema, detectorCoverageSchema } from "../detect/types";
import { isReachableClass } from "../evidence/gate";
import { downgradeTraceSchema } from "../evidence/trace";
import { detectorNameSchema, findingClassSchema } from "../rules/types";

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
  });

export type CandidateFinding = z.infer<typeof candidateFindingSchema>;
