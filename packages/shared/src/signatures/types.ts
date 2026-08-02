import { z } from "zod";

export const suppressionReasonCodeSchema = z.enum([
  "dismissed",
  "already_delivered",
  "not_seen_before",
  "seen_not_delivered",
  "unresolvable_ancestry",
  "unknown_shape_version",
]);
export type SuppressionReasonCode = z.infer<typeof suppressionReasonCodeSchema>;

export const ancestryReasonSchema = z.enum([
  "surface_normalisation_version_bump",

  "evidence_shape_version_bump",

  "signature_tuple_version_bump",

  "surface_rename",

  "surface_derivation_swap",
]);
export type AncestryReason = z.infer<typeof ancestryReasonSchema>;

export const ANCESTRY_REASONS = [
  "surface_normalisation_version_bump",
  "evidence_shape_version_bump",
  "signature_tuple_version_bump",
  "surface_rename",
  "surface_derivation_swap",
] as const satisfies readonly [AncestryReason, ...AncestryReason[]];

export const dismissalActionSchema = z.enum(["not_useful"]);
export type DismissalAction = z.infer<typeof dismissalActionSchema>;

export const DISMISSAL_ACTIONS = ["not_useful"] as const satisfies readonly [
  DismissalAction,
  ...DismissalAction[],
];

export const ANCESTRY_RESOLUTION_MAX_HOPS = 8;
