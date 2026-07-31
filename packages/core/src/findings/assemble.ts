// The candidate assembler — the join O-012 exists to build.
//
// Everything it composes already shipped: the T1 detectors propose
// (`../detect`), the gate concludes (`../evidence/gate`), the shape serialiser
// gives the claim its identity string (`./evidence-shape`), and
// `candidateFindingSchema` refuses anything malformed at the exit. This module
// adds NO judgement of its own — it is the wiring between four proven pieces,
// and every decision below is a citation, not a choice.
//
// PURE (D-13): the rule set arrives as a parameter, the window arrives on the
// candidates, and nothing here reads a clock, the environment, or the network.
// The same detector results assemble to the same candidates forever.
import type { DetectorCandidate, DetectorResult } from "../detect/types";
import { evaluate } from "../evidence/gate";
import { confidenceBasisForPass } from "../evidence/predicates";
import type { DowngradeTrace } from "../evidence/trace";
import type { ThresholdRuleSet } from "../rules/types";
import { candidateFindingSchema } from "./candidate";
import type { CandidateFinding } from "./candidate";
import { EVIDENCE_SHAPE_VERSION, evidenceShape } from "./evidence-shape";

/**
 * A candidate the gate REFUSED, carried for observability and nothing else.
 *
 * The gate's verdict is final (O-012): a dropped candidate never reaches a
 * lane, is never "helpfully" upgraded, and never becomes a finding — but a
 * drop must also never be SILENT (D5: zero passing candidates is a named
 * outcome). The producer logs these; no downstream consumer may resurrect
 * them, which is why the shape carries the trace and deliberately NOT the
 * signals or counts a resurrection would need.
 */
export type RejectedCandidate = {
  readonly detector: DetectorCandidate["detector"];
  readonly surface: string;
  readonly trace: DowngradeTrace;
};

export type AssembledCandidates = {
  /** Every gate-passed candidate, as the schema-refused contract. */
  readonly candidates: readonly CandidateFinding[];
  /** Every gate-dropped candidate, named rather than vanished. */
  readonly rejected: readonly RejectedCandidate[];
};

/**
 * Runs every detector's proposals through the evidence gate and assembles the
 * survivors into `CandidateFinding`s.
 *
 * D3, decided out loud (O-012): two detectors firing on one surface in one
 * window are ONE lane with TWO candidates, never two lanes. This function
 * flattens all detector results into a single candidate list for exactly that
 * reason — the caller builds one `AnalysisLane` per project, and
 * `sessionsConsidered` (the corpus's `basis.kept`) is stated once, not once
 * per detector.
 *
 * Derivations, each from a shipped rule rather than invented here:
 * - `finalClass` and `trace` are the gate's verdict verbatim — `evaluate`
 *   already appends the satisfied entry on a pass (ES-15).
 * - `evidenceShape` is serialised at `EVIDENCE_SHAPE_VERSION` with
 *   `symptomClass: finalClass` — identity follows what the gate CONCLUDED,
 *   not what the detector claimed, or a downgrade would fork the signature.
 * - `ranking.sampleSize` is `counts[0]`: PL ruling 15 declares the order, and
 *   [0] is the reached-the-surface count whose denominator the ranking rests
 *   on.
 * - `ranking.confidenceBasis` comes from `confidenceBasisForPass`, which lives
 *   beside the predicate maths it must agree with.
 * - `thresholdRuleSetVersion` is `ruleSet.version` — the SAME object that
 *   gated, so the version a candidate names is provably the version that
 *   judged it, never a second parameter that could disagree.
 *
 * FAIL DIRECTION: throw. A detector candidate the gate's Zod boundary refuses,
 * or an assembled candidate `candidateFindingSchema` refuses, is a CONTRACT
 * VIOLATION between two modules of this package — a bug, not an input. The
 * caller isolates per project (D8), so one broken lane costs one project's
 * tick, never the fleet's.
 */
export function assembleCandidates(
  results: readonly DetectorResult[],
  ruleSet: ThresholdRuleSet,
): AssembledCandidates {
  const candidates: CandidateFinding[] = [];
  const rejected: RejectedCandidate[] = [];

  for (const result of results) {
    for (const candidate of result.candidates) {
      // The claim is the candidate minus `claimSubject` — `proposedClaimSchema`
      // is the gate's boundary and re-parses it (ES-12). Field by field, never
      // a spread: a field added to `DetectorCandidate` later must be admitted
      // to the claim deliberately, not ride along silently.
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
            // PL ruling 15: [0] is the declared reached-the-surface count.
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
