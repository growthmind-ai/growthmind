// The typed candidate-finding contract handed to.
//
// This is the shape three downstream outcomes compile against: the candidate itself,
// the signature and ledger maths, the block renderer. Nothing invalid may be
// constructible through it. A candidate whose final class the gate could not have
// reached, or one carrying a count without its denominator, is rejected here rather
// than discovered in Slack.
//
// Implemented in Wave 4 against this scaffold's final signatures.
import { z } from "zod";

import { measuredCountSchema } from "../counts/measured-count";
import { analysisWindowSchema, claimSubjectSchema, detectorCoverageSchema } from "../detect/types";
import { isReachableClass } from "../evidence/gate";
import { downgradeTraceSchema } from "../evidence/trace";
import { detectorNameSchema, findingClassSchema } from "../rules/types";

// lists `proposedClaimSchema` in this module. It is defined in `../evidence/gate.ts`.
// The gate parses with it, and the candidate schema needs the gate's reachability rule,
// so defining it there keeps the arrow `candidate -> gate` running one way with no
// package-internal cycle. This re-export is what makes the tree read true at this
// module's export surface.
export { proposedClaimSchema } from "../evidence/gate";
export type { ProposedClaim } from "../evidence/gate";

/**
 * How much weight the evidence can bear. Ranks on this; this sprint only states it, and
 * implements no ranking at all.
 */
export const confidenceBasisSchema = z.enum([
  /** At or above every threshold the detector applied. */
  "threshold_met",
  /** Exactly at the inclusive boundary. The case, named rather than folded into
   * `threshold_met`, because may want to rank it lower. */
  "at_threshold",
  /** Below a threshold: present in the output for provenance, never surfaced as a
   * finding on its own. */
  "below_threshold",
]);
export type ConfidenceBasis = z.infer<typeof confidenceBasisSchema>;

/**
 * The inputs ranking will need, present and asserted, with no ranking implemented.
 * Carrying them now is what stops having to re-derive a sample size from a rendered
 * string.
 */
export const rankingInputsSchema = z.object({
  /** The count whose denominator the ranking rests on. */
  sampleSize: measuredCountSchema,
  confidenceBasis: confidenceBasisSchema,
});
export type RankingInputs = z.infer<typeof rankingInputsSchema>;

/**
 * A candidate finding: what the detector claimed, what the gate concluded, the ordered
 * record of how it got there, and every magnitude beside (never inside) its identity.
 *
 * Refusals, each asserted by a named test:
 * A `finalClass` unreachable from `claimedClass` via `DOWNGRADE_PATH`. Such a candidate
 *  did not come out of this gate;
 * A count that is not a branded `MeasuredCount`, i.e. one built without its
 *  denominator;
 * One that does not say what its `surface` is a claim about. The refusal is what makes
 *  `claimSubject` a wire rather than a field the detectors write and nobody reads.
 */
export const candidateFindingSchema = z
  .object({
    detector: detectorNameSchema,
    claimedClass: findingClassSchema,
    finalClass: findingClassSchema,
    trace: downgradeTraceSchema,
    counts: z.array(measuredCountSchema).min(1),
    timeframe: analysisWindowSchema,
    /**
     * What `surface` below is a claim about. Required, and stated in the schema rather
     * than in a comment.
     *
     * Both T1 detectors already set this on `DetectorCandidate`; until this field
     * existed nothing read it, so the value was computed and dropped on the floor. The
     * dead-wire shape the edge-case taxonomy calls. hashes this identity, and a
     * candidate reaching it with no stated subject would be a surface claim by
     * assumption rather than by contract. Optional would be the same dead wire with a
     * nicer type: a claim about something else must edit `claimSubjectSchema`, and that
     * edit is the compile-visible event this field exists to force.
     */
    claimSubject: claimSubjectSchema,
    /** The normalised `url_path` this claim is about. */
    surface: z.string().min(1),
    /** `null` for a row written before versions were recorded. */
    surfaceNormalisationVersion: z.number().int().nullable(),
    /** The canonical string, not a hash, hashes it. */
    evidenceShape: z.string().min(1),
    evidenceShapeVersion: z.number().int().positive(),
    /** Which rule set produced every threshold judgement above. */
    thresholdRuleSetVersion: z.number().int().positive(),
    ranking: rankingInputsSchema,
    /** The run's coverage travels onto every candidate. */
    coverage: detectorCoverageSchema,
  })
  .refine((candidate) => isReachableClass(candidate.claimedClass, candidate.finalClass), {
    message:
      "a candidate's final class must be reachable from its claimed class by the downgrade path",
    path: ["finalClass"],
  });

export type CandidateFinding = z.infer<typeof candidateFindingSchema>;
