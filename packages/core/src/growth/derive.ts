import { URL_PATH_NORMALISATION_VERSION, isNormalisedUrlPath } from "@growthmind/shared";
import type { SurfaceRole, WorthBasis } from "@growthmind/shared";
import { z } from "zod";

import { ROLED_SURFACE_LIMIT, type RoledSurface } from "./context";

// A role is a proposal until a person agrees with it, and a wrong one distorts the queue
// without ever reporting a fault. Every threshold below is a floor on how much has to have
// been seen before this will say anything at all.
export const DERIVE_MIN_SESSIONS = 5;

export const DERIVE_MIN_SHARE = 0.3;

// Narrow on purpose, and NOT the §5 deny list. That list is broad because over-refusing a
// fix is cheap; this one decides a weight of 8, where a false positive quietly promotes a
// blog post above a real problem. `/blog/pricing-strategy` is refused by the deny list and
// roled `unknown` by this.
export const MONEY_SEGMENTS: readonly string[] = [
  "checkout",
  "billing",
  "payment",
  "payments",
  "subscribe",
  "subscription",
  "upgrade",
  "purchase",
  "paywall",
];

export const surfaceObservationSchema = z.object({
  surface: z.string().min(1),

  normalisationVersion: z.number().int().positive(),

  sessions: z.number().int().nonnegative(),

  // Visits made during an identity's own first session, by identities that came back.
  firstSessionVisitsByReturners: z.number().int().nonnegative(),

  visitsByReturningIdentities: z.number().int().nonnegative(),

  // Sessions that reached this surface and a money surface in the same visit. Co-occurrence,
  // not order: proving one came before the other needs the funnel understanding the model
  // tier supplies, and this tier only ever proposes.
  sessionsAlsoReachingMoney: z.number().int().nonnegative(),
});

export type SurfaceObservation = z.infer<typeof surfaceObservationSchema>;

function shareOf(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

function looksLikeMoney(surface: string): boolean {
  return surface
    .toLowerCase()
    .split("/")
    .filter((segment) => segment.length > 0)
    .some((segment) => MONEY_SEGMENTS.some((marker) => segment.includes(marker)));
}

export type RoleProposal = {
  readonly role: SurfaceRole;
  readonly basis: WorthBasis;
};

// Every branch that cannot clear its floor falls through to `unknown`, which weighs 1 and
// leaves the ordering as it was. That is the safe direction: a miss costs a better ranking,
// a guess costs a wrong one that nobody can see.
export function proposeRole(observation: SurfaceObservation): RoleProposal {
  const seen = surfaceObservationSchema.parse(observation);

  if (looksLikeMoney(seen.surface)) {
    return { role: "makes_money", basis: "derived_from_product" };
  }

  if (seen.sessions < DERIVE_MIN_SESSIONS) {
    return { role: "unknown", basis: "derived_from_product" };
  }

  // Descending by weight, so a surface that fits more than one description is given the one
  // that matters most rather than whichever was tested first.
  if (shareOf(seen.firstSessionVisitsByReturners, seen.sessions) >= DERIVE_MIN_SHARE) {
    return { role: "first_value", basis: "observed_from_behaviour" };
  }

  if (shareOf(seen.sessionsAlsoReachingMoney, seen.sessions) >= DERIVE_MIN_SHARE) {
    return { role: "leads_to_money", basis: "observed_from_behaviour" };
  }

  if (shareOf(seen.visitsByReturningIdentities, seen.sessions) >= DERIVE_MIN_SHARE) {
    return { role: "keeps_people", basis: "observed_from_behaviour" };
  }

  return { role: "unknown", basis: "derived_from_product" };
}

export type DeriveInput = {
  readonly observations: readonly SurfaceObservation[];
  readonly existing: readonly RoledSurface[];
  readonly derivedAt: Date;
};

// What a person has confirmed is never re-derived over. A correction that a later run can
// silently discard is worse than never having asked for one.
export function deriveRoledSurfaces(input: DeriveInput): readonly RoledSurface[] {
  const confirmed = new Map<string, RoledSurface>();
  for (const roled of input.existing) {
    if (roled.confirmedAt !== null) confirmed.set(roled.surface, roled);
  }

  const proposed: RoledSurface[] = [];
  for (const observation of input.observations) {
    if (confirmed.has(observation.surface)) continue;

    if (
      !isNormalisedUrlPath(observation.surface) ||
      observation.normalisationVersion !== URL_PATH_NORMALISATION_VERSION
    ) {
      continue;
    }

    const proposal = proposeRole(observation);
    if (proposal.role === "unknown") continue;

    proposed.push({
      surface: observation.surface,
      role: proposal.role,
      basis: proposal.basis,
      confirmedAt: null,
      normalisationVersion: observation.normalisationVersion,
    });
  }

  return [...confirmed.values(), ...proposed].slice(0, ROLED_SURFACE_LIMIT);
}
