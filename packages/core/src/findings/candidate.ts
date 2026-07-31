// The typed candidate-finding contract handed to O-005 (O-004 FR-17, ES-12).
//
// This is the shape three downstream outcomes compile against: O-005 the
// candidate itself, O-006 the signature and ledger maths, O-007 the block
// renderer. Nothing invalid may be constructible through it — a candidate
// whose final class the gate could not have reached, or one carrying a count
// without its denominator, is rejected here rather than discovered in Slack.
//
// Implemented in Wave 4 against this scaffold's final signatures.
import { z } from "zod";

import { measuredCountSchema } from "../counts/measured-count";
import { analysisWindowSchema, claimSubjectSchema, detectorCoverageSchema } from "../detect/types";
import { isReachableClass } from "../evidence/gate";
import { downgradeTraceSchema } from "../evidence/trace";
import { detectorNameSchema, findingClassSchema } from "../rules/types";

// ADD §6.1 lists `proposedClaimSchema` in this module. It is DEFINED in
// `../evidence/gate.ts` — the gate parses with it, and the candidate schema
// needs the gate's reachability rule, so defining it there keeps the arrow
// `candidate -> gate` running one way with no package-internal cycle. This
// re-export is what makes the tree read true at this module's export surface.
export { proposedClaimSchema } from "../evidence/gate";
export type { ProposedClaim } from "../evidence/gate";

/**
 * How much weight the evidence can bear. O-006 RANKS on this; this sprint only
 * states it, and implements no ranking at all (FR-17).
 */
export const confidenceBasisSchema = z.enum([
  /** At or above every threshold the detector applied. */
  "threshold_met",
  /** Exactly at the inclusive boundary — the D-6 case, named rather than
   * folded into `threshold_met`, because O-006 may want to rank it lower. */
  "at_threshold",
  /** Below a threshold: present in the output for provenance, never surfaced
   * as a finding on its own. */
  "below_threshold",
]);
export type ConfidenceBasis = z.infer<typeof confidenceBasisSchema>;

/**
 * The INPUTS ranking will need, present and asserted — with no ranking
 * implemented (FR-17). Carrying them now is what stops O-006 having to
 * re-derive a sample size from a rendered string.
 */
export const rankingInputsSchema = z.object({
  /** The count whose denominator the ranking rests on. */
  sampleSize: measuredCountSchema,
  confidenceBasis: confidenceBasisSchema,
});
export type RankingInputs = z.infer<typeof rankingInputsSchema>;

/**
 * A candidate finding: what the detector claimed, what the gate concluded, the
 * ordered record of how it got there, and every magnitude beside — never
 * inside — its identity.
 *
 * Refusals, each asserted by a named test:
 * - a `finalClass` unreachable from `claimedClass` via `DOWNGRADE_PATH`
 *   (FR-17) — such a candidate did not come out of this gate;
 * - a count that is not a branded `MeasuredCount`, i.e. one built without its
 *   denominator (FR-17, FR-10);
 * - one that does not say what its `surface` is a claim ABOUT (FR-3c, ESC-6) —
 *   the refusal is what makes `claimSubject` a wire rather than a field the
 *   detectors write and nobody reads.
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
     * What `surface` below is a claim ABOUT (O-005 D-5, ESC-6) — REQUIRED, and
     * stated in the schema rather than in a comment (FR-3c).
     *
     * Both T1 detectors already SET this on `DetectorCandidate`; until this
     * field existed nothing read it, so the value was computed and dropped on
     * the floor — the dead-wire shape the edge-case taxonomy calls D11. O-006
     * hashes this identity, and a candidate reaching it with no stated subject
     * would be a surface claim by ASSUMPTION rather than by contract. Optional
     * would be the same dead wire with a nicer type: a claim about something
     * else must edit `claimSubjectSchema`, and that edit is the compile-visible
     * event this field exists to force.
     */
    claimSubject: claimSubjectSchema,
    /** The normalised `url_path` this claim is about. */
    surface: z.string().min(1),
    /** `null` for a row written before versions were recorded (ES-14). */
    surfaceNormalisationVersion: z.number().int().nullable(),
    /** The canonical string, NOT a hash — O-006 hashes it (D-12). */
    evidenceShape: z.string().min(1),
    evidenceShapeVersion: z.number().int().positive(),
    /** Which rule set produced every threshold judgement above (FR-8). */
    thresholdRuleSetVersion: z.number().int().positive(),
    ranking: rankingInputsSchema,
    /** D-3: the run's coverage travels onto every candidate. */
    coverage: detectorCoverageSchema,
  })
  .refine((candidate) => isReachableClass(candidate.claimedClass, candidate.finalClass), {
    message:
      "a candidate's final class must be reachable from its claimed class by the downgrade path",
    path: ["finalClass"],
  });

export type CandidateFinding = z.infer<typeof candidateFindingSchema>;
