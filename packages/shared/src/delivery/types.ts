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

// What one tick concluded about one lane. Wider than `deliveryStatusSchema`, which only
// describes a delivery that exists: most ticks end without one, and a record that cannot
// distinguish a deliberate quiet day from a worker that stopped running answers neither.
export const deliveryLaneDecisionSchema = z.enum([
  "posted",

  "failed",

  "blocked_by_pii",

  "nothing_today",

  "not_claimed",

  "not_connected",

  "unresolvable",

  "lane_errored",
]);
export type DeliveryLaneDecision = z.infer<typeof deliveryLaneDecisionSchema>;

export const DELIVERY_LANE_DECISIONS = [
  "posted",
  "failed",
  "blocked_by_pii",
  "nothing_today",
  "not_claimed",
  "not_connected",
  "unresolvable",
  "lane_errored",
] as const satisfies readonly [DeliveryLaneDecision, ...DeliveryLaneDecision[]];

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
