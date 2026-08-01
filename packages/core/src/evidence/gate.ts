// The evidence gate.
//
// This is the product's identity, not a feature. mvp.md: "a summary without
// deterministic proof predicates is an AI narrating a session, which exists to
// prevent." Architecture the ladder is implemented here exactly, as data plus a bounded
// descent, never as a chain of `if`s a reader has to simulate.
//
// Implemented in Wave 4 against this scaffold's final signatures.
import { z } from "zod";

import { measuredCountSchema } from "../counts/measured-count";
import type { MeasuredCount } from "../counts/measured-count";
import { analysisWindowSchema, detectorCoverageSchema } from "../detect/types";
import type { AnalysisWindow, DetectorCoverage } from "../detect/types";
import { detectorNameSchema, findingClassSchema } from "../rules/types";
import type { DetectorName, FindingClass, ThresholdRuleSet } from "../rules/types";
import { PROOF_PREDICATES } from "./predicates";
import { evidenceSignalSchema } from "./signals";
import type { EvidenceSignal } from "./signals";
import { traceEntry } from "./trace";
import type { DowngradeTrace, TraceEntry } from "./trace";

/** Where a failed proof descends to: another class, or out of the product. */
export type DowngradeDestination = FindingClass | "drop";

/**
 * Architecture the ladder, as data. The value is the class a failed proof descends to.
 */
export const DOWNGRADE_PATH: Readonly<Record<FindingClass, DowngradeDestination>> = {
  broken: "confusing",

  // The floor. This is "drop", not "changed_mind".
  //
  // Read this before "fixing" the apparent gap in the ordering. The ladder is not
  // ordered by strength. `changed_mind` is not a weaker claim than `confusing`. It is a
  // differently-directed attribution, and it happens to be the most product-flattering
  // class of the four. Its proof predicate is "clean exit, no error, no struggle
  // signal", which is satisfied by the absence of everything.
  //
  // Left unfloored,'s own headline case walks off the end of the ladder and passes.
  // Trace it: a save silently fails. Nothing throws, no request event fires, and the
  // current `events` schema cannot see it at all -> `broken` finds no correlated
  // failure signal -> downgrade -> `confusing` finds no hesitation, because the user
  // clicked once and left -> downgrade -> `changed_mind` requires a clean exit, no
  // error, and no struggle signal, and all three are literally TRUE -> the claim
  // passes. The product then tells a founder "this user changed their mind" when in
  // fact the product broke under them.
  //
  // That violates product-decisions head-on. "must distinguish a bug from a design
  // problem from a user who simply changed their mind: three different findings, three
  // different owners", and "no verdict beats a wrong verdict" at the same time. "fails
  // toward the weaker claim" must never mean "falls through to the class that blames
  // the user."
  //
  // This one line is the only thing standing between reading `confusing -> drop` as a
  // gap in an obvious ordering and shipping that incident.
  confusing: "drop",

  // `changed_mind` keeps its own row so an originally proposed one (from a model) is
  // evaluated normally and drops when its proof is absent. The own "if proof is absent:
  // drop". It is unreachable as a destination because no other row names it, which a
  // test asserts over this map's values directly: stronger than a behavioural test,
  // because it cannot pass vacuously.
  changed_mind: "drop",

  instrumentation: "drop",
};

/**
 * What the gate evaluates: a claim proposed by a detector (restricts those to three
 * classes) or by a model (which may propose all four).
 *
 * Re-exported from `../findings/candidate.ts` so the tree reads true at that module's
 * export surface; it is defined here so the arrow runs `candidate -> gate` in one
 * direction only, with no package-internal cycle.
 */
export type ProposedClaim = {
  readonly detector: DetectorName;
  readonly claimedClass: FindingClass;
  readonly surface: string;
  readonly surfaceNormalisationVersion: number | null;
  readonly signals: readonly EvidenceSignal[];
  readonly counts: readonly MeasuredCount[];
  readonly timeframe: AnalysisWindow;
  readonly coverage: DetectorCoverage;
};

/**
 * The gate's Zod boundary. A claim naming a class the gate has no predicate for
 * is malformed input and is rejected here, never defaulted to the weakest class, and
 * never to the most flattering one. A model's output is external data and is validated
 * like any other.
 */
export const proposedClaimSchema = z.object({
  detector: detectorNameSchema,
  claimedClass: findingClassSchema,
  surface: z.string().min(1),
  surfaceNormalisationVersion: z.number().int().nullable(),
  signals: z.array(evidenceSignalSchema),
  counts: z.array(measuredCountSchema),
  timeframe: analysisWindowSchema,
  coverage: detectorCoverageSchema,
});

/**
 * The gate's verdict. `pass` carries the class the proof actually supports; `drop`
 * carries no class at all, because there is nothing to say.
 *
 * Both carry the trace: a passing claim records its satisfied predicate, so "we checked
 * and it held" is never confusable with "we did not check".
 */
export type GateOutcome =
  | { readonly kind: "pass"; readonly finalClass: FindingClass; readonly trace: DowngradeTrace }
  | { readonly kind: "drop"; readonly trace: DowngradeTrace };

/**
 * Evaluates a claim against the ladder, to a fixed point.
 *
 * The walk: parse `claim` with `proposedClaimSchema` (. An unknown class is
 * rejected here, by throw, never defaulted); evaluate the current rung's predicate from
 * `PROOF_PREDICATES`; if satisfied, return `pass` with the satisfied trace entry
 * appended; if not, append the unsatisfied entry and step to `DOWNGRADE_PATH[current]`;
 * `"drop"` terminates.
 *
 * Termination is guaranteed by a visited-class set (a class is never re-entered) over a
 * four-member union, and is asserted by a test rather than argued in a comment.
 *
 * The gate can never return a class stronger than the one claimed: the descent only
 * ever moves along `DOWNGRADE_PATH`, and nothing in it ascends.
 *
 * `claim` is `unknown` deliberately: the Zod parse is the boundary, and typing the
 * parameter would let a caller skip it.
 *
 * Pure: the rule set arrives as a parameter, nothing reads `CURRENT_*`, and there is no
 * clock and no randomness anywhere in the descent.
 */
export function evaluate(claim: unknown, ruleSet: ThresholdRuleSet): GateOutcome {
  // . The boundary, and it comes first. `.parse` throws on a class the gate has no
  // predicate for; it does not fall back, and there is no `??` and no default anywhere
  // below. A malformed claim leaves here as a `ZodError`, never as a verdict.
  const parsed: ProposedClaim = proposedClaimSchema.parse(claim);

  const trace: TraceEntry[] = [];

  // Termination, structurally. A class is entered at most once, so the descent is
  // bounded by the four-member union no matter what `DOWNGRADE_PATH` says. The bound
  // does not depend on the map staying acyclic. asks for this to be true by
  // construction rather than argued; the enumerated 128-cell test then asserts it
  // rather than trusting this comment.
  const visited = new Set<FindingClass>();

  // The descent only ever moves along `DOWNGRADE_PATH`, so it can never return a class
  // stronger than the one claimed: there is no other way to reach the next rung.
  let current: DowngradeDestination = parsed.claimedClass;

  while (current !== "drop" && !visited.has(current)) {
    visited.add(current);

    const predicate = PROOF_PREDICATES[current];
    const satisfied = predicate.satisfied(parsed.signals, ruleSet);

    // /: appended at every rung, satisfied or not. A passing claim carries its
    // satisfied entry too, so "we checked and it held" is never confusable with "we did
    // not check".
    trace.push(
      traceEntry({
        class: current,
        predicate: predicate.name,
        predicateVersion: predicate.version,
        satisfied,
      }),
    );

    if (satisfied) {
      return { kind: "pass", finalClass: current, trace };
    }

    current = DOWNGRADE_PATH[current];
  }

  // `drop` carries no class at all, because there is nothing to say.
  return { kind: "drop", trace };
}

/**
 * True when `finalClass` is a class the ladder can actually reach from `claimedClass`,
 * the same class, or one reached by walking `DOWNGRADE_PATH`.
 *
 * This is what `candidateFindingSchema` refuses on: a candidate whose final class is
 * unreachable from its claimed class did not come out of this gate, whatever it says it
 * is.
 */
export function isReachableClass(claimedClass: FindingClass, finalClass: FindingClass): boolean {
  // The same walk `evaluate` performs, over the same map, with the same visited-set
  // bound, so the two can never disagree about what the ladder can reach. Predicates
  // play no part here: reachability is a property of the map, not of the evidence.
  const visited = new Set<FindingClass>();
  let current: DowngradeDestination = claimedClass;

  while (current !== "drop" && !visited.has(current)) {
    if (current === finalClass) return true;
    visited.add(current);
    current = DOWNGRADE_PATH[current];
  }

  return false;
}
