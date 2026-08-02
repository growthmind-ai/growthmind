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

export function evaluate(claim: unknown, ruleSet: ThresholdRuleSet): GateOutcome {
  const parsed: ProposedClaim = proposedClaimSchema.parse(claim);

  const trace: TraceEntry[] = [];

  const visited = new Set<FindingClass>();

  let current: DowngradeDestination = parsed.claimedClass;

  while (current !== "drop" && !visited.has(current)) {
    visited.add(current);

    const predicate = PROOF_PREDICATES[current];
    const satisfied = predicate.satisfied(parsed.signals, ruleSet);

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
