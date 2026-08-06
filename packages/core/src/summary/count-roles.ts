import type { MeasuredCount } from "../counts/measured-count";
import type { CandidateFinding } from "../findings/candidate";
import type { DetectorName } from "../rules/types";

export type CountRole = "reached_surface" | "left_without_continuing" | "affected_sessions";

export const COUNT_ROLES = {
  funnel_dropoff: ["reached_surface", "left_without_continuing"],

  error_event: ["affected_sessions"],

  // O-041 §3: exactly two counts, sessions-on-surface then qualifying sessions —
  // error_event's one-exposure/one-harm shape, not funnel_dropoff's directional
  // funnel framing (an observed struggle is not "leaving without continuing").
  observed_struggle: ["reached_surface", "affected_sessions"],
} as const satisfies Record<DetectorName, readonly CountRole[]>;

// The role whose count names the harm, not the exposure. `satisfies` makes a new
// detector a compile error until its impact role is named.
export const IMPACT_ROLE = {
  funnel_dropoff: "left_without_continuing",

  error_event: "affected_sessions",

  observed_struggle: "affected_sessions",
} as const satisfies Record<DetectorName, CountRole>;

export type ResolvedCounts = {
  readonly [D in DetectorName]: {
    readonly detector: D;
    readonly counts: { readonly [R in (typeof COUNT_ROLES)[D][number]]: MeasuredCount };
  };
}[DetectorName];

export function resolveCounts(candidate: CandidateFinding): ResolvedCounts {
  const roles: readonly CountRole[] = COUNT_ROLES[candidate.detector];

  if (candidate.counts.length !== roles.length) {
    throw new Error(
      `a ${candidate.detector} candidate must carry one count per declared role: ` +
        `${String(roles.length)} declared, ${String(candidate.counts.length)} received`,
    );
  }

  const byRole: Record<string, MeasuredCount> = {};
  for (const [index, role] of roles.entries()) {
    byRole[role] = candidate.counts[index];
  }

  const missing = roles.filter((role) => !(role in byRole));
  if (missing.length > 0) {
    throw new Error(
      `a ${candidate.detector} candidate resolved no count for ${missing.join(", ")}: ` +
        `its declared roles are not distinct`,
    );
  }

  return { detector: candidate.detector, counts: byRole } as ResolvedCounts;
}
