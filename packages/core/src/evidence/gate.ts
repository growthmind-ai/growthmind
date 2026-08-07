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

export type DowngradeDestination = FindingClass | "drop";

export const DOWNGRADE_PATH: Readonly<Record<FindingClass, DowngradeDestination>> = {
  broken: "confusing",

  confusing: "drop",

  changed_mind: "drop",

  instrumentation: "drop",
};

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

export type GateOutcome =
  | { readonly kind: "pass"; readonly finalClass: FindingClass; readonly trace: DowngradeTrace }
  | { readonly kind: "drop"; readonly trace: DowngradeTrace };

// The schema validates that a signal is well-formed, never that it is about the claim it was
// handed with — so a claim about /checkout could be proved by struggle on a different page, or
// by an exception from outside the window the claim covers. Surface mismatch is the most likely
// thing a model fabricates, and this file's whole premise is that model output is external data
// (B-017). A signal that is not about the claim is not proof of it, so it is dropped before the
// ladder descends rather than refused loudly: the claim then stands on whatever else it has.
function isAboutClaim(signal: EvidenceSignal, claim: ProposedClaim): boolean {
  switch (signal.kind) {
    case "struggle":
    case "clean_exit":
      return signal.surface === claim.surface;
    case "failure_correlated":
    case "failure_uncorrelated":
      return withinTimeframe(signal.occurredAt, claim.timeframe);
    case "instrumentation_rate_drop":
      // Carries neither a surface nor an instant; its two counts carry their own windows.
      return true;
  }
}

function withinTimeframe(instant: Date, timeframe: AnalysisWindow): boolean {
  return instant >= timeframe.start && instant <= timeframe.end;
}

export function evaluate(claim: unknown, ruleSet: ThresholdRuleSet): GateOutcome {
  const parsed: ProposedClaim = proposedClaimSchema.parse(claim);
  const proving = parsed.signals.filter((signal) => isAboutClaim(signal, parsed));

  const trace: TraceEntry[] = [];

  const visited = new Set<FindingClass>();

  let current: DowngradeDestination = parsed.claimedClass;

  while (current !== "drop" && !visited.has(current)) {
    visited.add(current);

    const predicate = PROOF_PREDICATES[current];
    const satisfied = predicate.satisfied(proving, ruleSet);

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

  return { kind: "drop", trace };
}

export function isReachableClass(claimedClass: FindingClass, finalClass: FindingClass): boolean {
  const visited = new Set<FindingClass>();
  let current: DowngradeDestination = claimedClass;

  while (current !== "drop" && !visited.has(current)) {
    if (current === finalClass) return true;
    visited.add(current);
    current = DOWNGRADE_PATH[current];
  }

  return false;
}
