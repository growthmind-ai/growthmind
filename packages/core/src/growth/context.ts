import {
  URL_PATH_NORMALISATION_VERSION,
  isNormalisedUrlPath,
  surfaceRoleSchema,
  worthBasisSchema,
} from "@growthmind/shared";
import { z } from "zod";

import { EMPTY_PROPOSAL_SCOPE, type ProposalScope } from "./proposable";
import { surfaceWorth, unknownWorth } from "./surface-worth";
import type { SurfaceWorth } from "./surface-worth";

export const ROLED_SURFACE_LIMIT = 200;

// Normalisation is enforced here rather than at read: a stored surface that cannot be
// matched against a finding's own surface would rank nothing, silently. One bad row costs
// the whole context, which the reader answers as absence — every weight 1, ordering
// unchanged — instead of a per-finding throw on the delivery path.
export const roledSurfaceSchema = z.object({
  surface: z.string().min(1).refine(isNormalisedUrlPath, {
    message: "a roled surface must be a normalised url path",
  }),
  role: surfaceRoleSchema,
  basis: worthBasisSchema,
  confirmedAt: z.coerce.date().nullable(),

  // Roles are matched to a finding's surface by string, so a normaliser change re-spells
  // every stored one and none of them match again.
  normalisationVersion: z.number().int().positive(),
});

export type RoledSurface = z.infer<typeof roledSurfaceSchema>;

export const growthContextSchema = z.object({
  surfaces: z.array(roledSurfaceSchema).max(ROLED_SURFACE_LIMIT),
  confirmedChangeable: z.array(z.string().min(1)).max(ROLED_SURFACE_LIMIT),
});

export type GrowthContextInput = z.infer<typeof growthContextSchema>;

export type GrowthContext = {
  readonly bySurface: ReadonlyMap<string, RoledSurface>;
  readonly confirmedChangeable: ReadonlySet<string>;
};

export function growthContext(input: GrowthContextInput): GrowthContext {
  const parsed = growthContextSchema.parse(input);

  const bySurface = new Map<string, RoledSurface>();
  for (const roled of parsed.surfaces) {
    bySurface.set(roled.surface, roled);
  }

  return { bySurface, confirmedChangeable: new Set(parsed.confirmedChangeable) };
}

export const EMPTY_GROWTH_CONTEXT: GrowthContext = {
  bySurface: new Map<string, RoledSurface>(),
  confirmedChangeable: new Set<string>(),
};

// A surface nothing has been said about, and every surface when the context is absent,
// answers `unknown` — which weighs 1 and leaves the ordering exactly as it was.
export function worthOf(context: GrowthContext | null, surface: string): SurfaceWorth {
  const roled = context?.bySurface.get(surface);
  if (roled === undefined) {
    return unknownWorth(surface);
  }

  // Weighing an older spelling would rank on a coincidence of string equality.
  if (roled.normalisationVersion !== URL_PATH_NORMALISATION_VERSION) {
    return unknownWorth(surface);
  }

  return surfaceWorth({
    surface: roled.surface,
    role: roled.role,
    basis: roled.basis,
    confirmedAt: roled.confirmedAt,
  });
}

export function proposalScopeOf(context: GrowthContext | null): ProposalScope {
  if (context === null) {
    return EMPTY_PROPOSAL_SCOPE;
  }

  return { confirmedChangeable: context.confirmedChangeable };
}
