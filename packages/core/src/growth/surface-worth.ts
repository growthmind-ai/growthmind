import {
  isNormalisedUrlPath,
  surfaceRoleSchema,
  worthBasisSchema,
  type SurfaceRole,
  type WorthBasis,
} from "@growthmind/shared";
import { z } from "zod";

const STATED: unique symbol = Symbol("growthmind.stated-worth");

export const WORTH_WEIGHT_VERSION = 1;

// Bumping a weight reorders every queue for every customer at once, so the table is
// versioned and the version travels on the value it produced.
const WEIGHT_BY_ROLE: Record<SurfaceRole, number> = {
  makes_money: 8,
  first_value: 6,
  leads_to_money: 4,
  keeps_people: 3,
  unknown: 1,
};

export const UNWEIGHTED = WEIGHT_BY_ROLE.unknown;

export type SurfaceWorth = {
  readonly surface: string;
  readonly role: SurfaceRole;
  readonly weight: number;
  readonly weightVersion: number;
  readonly basis: WorthBasis;

  // Null until a human has agreed with it. A proposal and a confirmation rank the same;
  // the difference is what may be said about it out loud.
  readonly confirmedAt: Date | null;
  readonly [STATED]: true;
};

export type SurfaceWorthInput = {
  readonly surface: string;
  readonly role: SurfaceRole;
  readonly basis: WorthBasis;
  readonly confirmedAt: Date | null;
};

export const surfaceWorthInputSchema = z.object({
  surface: z.string().min(1),
  role: surfaceRoleSchema,
  basis: worthBasisSchema,
  confirmedAt: z.date().nullable(),
});

export function isSurfaceWorth(value: unknown): value is SurfaceWorth {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { readonly [STATED]?: unknown })[STATED] === true
  );
}

export const surfaceWorthSchema = z.custom<SurfaceWorth>((value) => isSurfaceWorth(value), {
  message: "worth must be built by surfaceWorth(), with its basis",
});

export function surfaceWorth(input: SurfaceWorthInput): SurfaceWorth {
  const parsed = surfaceWorthInputSchema.parse(input);

  if (!isNormalisedUrlPath(parsed.surface)) {
    throw new Error(`surface_worth_not_normalised: ${parsed.surface}`);
  }

  return {
    surface: parsed.surface,
    role: parsed.role,
    weight: WEIGHT_BY_ROLE[parsed.role],
    weightVersion: WORTH_WEIGHT_VERSION,
    basis: parsed.basis,
    confirmedAt: parsed.confirmedAt,
    [STATED]: true,
  };
}

// The answer for a surface nothing has been said about, and the answer whenever the
// growth context is absent. Ordering across a set of these is decided entirely by the
// keys that ranked before this existed.
//
// It does not validate the surface. Every caller on the absence path holds whatever the
// finding row carries, and a throw here would cost that finding its delivery over a
// weight of 1 that changes no ordering.
export function unknownWorth(surface: string): SurfaceWorth {
  return {
    surface,
    role: "unknown",
    weight: WEIGHT_BY_ROLE.unknown,
    weightVersion: WORTH_WEIGHT_VERSION,
    basis: "derived_from_product",
    confirmedAt: null,
    [STATED]: true,
  };
}

export function weightOfRole(role: SurfaceRole): number {
  return WEIGHT_BY_ROLE[role];
}
