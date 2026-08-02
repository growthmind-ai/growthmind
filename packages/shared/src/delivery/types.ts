import { z } from "zod";

export const deliveryDecisionSchema = z.enum(["deliver", "nothing_today"]);
export type DeliveryDecision = z.infer<typeof deliveryDecisionSchema>;

export const nothingTodayReasonSchema = z.enum([
  "one_already_open",

  "no_findings_ready",

  "budget_spent",
]);
export type NothingTodayReason = z.infer<typeof nothingTodayReasonSchema>;

export const deliveryStatusSchema = z.enum(["pending", "posted", "failed"]);
export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;

export const residualPiiKindSchema = z.enum([
  "email_address",

  "phone_number",

  "payment_card",

  "ip_address",

  "credential",
]);
export type ResidualPiiKind = z.infer<typeof residualPiiKindSchema>;

export const RESIDUAL_PII_KINDS = [
  "email_address",
  "phone_number",
  "payment_card",
  "ip_address",
  "credential",
] as const satisfies readonly [ResidualPiiKind, ...ResidualPiiKind[]];

export const NOTHING_TODAY_REASONS = [
  "one_already_open",
  "no_findings_ready",
  "budget_spent",
] as const satisfies readonly [NothingTodayReason, ...NothingTodayReason[]];
