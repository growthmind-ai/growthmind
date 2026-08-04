import { z } from "zod";

export const FORBIDDEN_REASONS = ["pricing_or_billing", "auth", "consent_or_terms"] as const;

export type ForbiddenReason = (typeof FORBIDDEN_REASONS)[number];

export const forbiddenReasonSchema = z.enum(FORBIDDEN_REASONS);
