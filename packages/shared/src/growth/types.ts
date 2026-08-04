import { z } from "zod";

export const FORBIDDEN_REASONS = ["pricing_or_billing", "auth", "consent_or_terms"] as const;

export type ForbiddenReason = (typeof FORBIDDEN_REASONS)[number];

export const forbiddenReasonSchema = z.enum(FORBIDDEN_REASONS);

export const SURFACE_ROLES = [
  "makes_money",
  "first_value",
  "leads_to_money",
  "keeps_people",
  "unknown",
] as const;

export type SurfaceRole = (typeof SURFACE_ROLES)[number];

export const surfaceRoleSchema = z.enum(SURFACE_ROLES);

export const WORTH_BASES = [
  "stated_by_customer",
  "derived_from_product",
  "observed_from_behaviour",
] as const;

export type WorthBasis = (typeof WORTH_BASES)[number];

export const worthBasisSchema = z.enum(WORTH_BASES);
