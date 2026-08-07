import { z } from "zod";

import {
  DELIVERY_LANE_DECISION_MESSAGES,
  DELIVERY_STATUS_MESSAGES,
  NOTHING_TODAY_REASON_MESSAGES,
  RESIDUAL_PII_KIND_MESSAGES,
  deliveryFailureSentence,
} from "./messages";
import type { PostFailureCode } from "./poster";
import type { DeliveryLaneDecision, NothingTodayReason, ResidualPiiKind } from "./types";

// Why a run continues, as a value nobody edits in a copy pass. The sentence beside it in
// `delivery_decisions.reason` is display prose: reword it and a key built on it forks, so
// every open run in the fleet closes and every lane's "quiet since" resets to today (D12).
export const deliveryReasonCodeSchema = z.enum([
  "lane_posted",
  "lane_failed",
  "lane_blocked_by_pii",
  "lane_nothing_today",
  "lane_not_claimed",
  "lane_not_connected",
  "lane_unresolvable",
  "lane_errored",

  "quiet_one_already_open",
  "quiet_no_findings_ready",
  "quiet_budget_spent",

  "pii_email_address",
  "pii_phone_number",
  "pii_payment_card",
  "pii_ip_address",
  "pii_credential",

  "post_not_delivered",
  "post_call_failed",
  "post_rejected",
  "post_not_authorised",
  "post_channel_unavailable",
]);
export type DeliveryReasonCode = z.infer<typeof deliveryReasonCodeSchema>;

export const DELIVERY_REASON_CODES = [
  "lane_posted",
  "lane_failed",
  "lane_blocked_by_pii",
  "lane_nothing_today",
  "lane_not_claimed",
  "lane_not_connected",
  "lane_unresolvable",
  "lane_errored",
  "quiet_one_already_open",
  "quiet_no_findings_ready",
  "quiet_budget_spent",
  "pii_email_address",
  "pii_phone_number",
  "pii_payment_card",
  "pii_ip_address",
  "pii_credential",
  "post_not_delivered",
  "post_call_failed",
  "post_rejected",
  "post_not_authorised",
  "post_channel_unavailable",
] as const satisfies readonly [DeliveryReasonCode, ...DeliveryReasonCode[]];

// Written out rather than composed from the union member, so adding a decision, a quiet
// reason, a residual kind or a failure code is a type error here instead of a silent gap.
export const LANE_DECISION_REASON_CODES: Record<DeliveryLaneDecision, DeliveryReasonCode> = {
  posted: "lane_posted",
  failed: "lane_failed",
  blocked_by_pii: "lane_blocked_by_pii",
  nothing_today: "lane_nothing_today",
  not_claimed: "lane_not_claimed",
  not_connected: "lane_not_connected",
  unresolvable: "lane_unresolvable",
  lane_errored: "lane_errored",
};

export const NOTHING_TODAY_REASON_CODES: Record<NothingTodayReason, DeliveryReasonCode> = {
  one_already_open: "quiet_one_already_open",
  no_findings_ready: "quiet_no_findings_ready",
  budget_spent: "quiet_budget_spent",
};

export const RESIDUAL_PII_REASON_CODES: Record<ResidualPiiKind, DeliveryReasonCode> = {
  email_address: "pii_email_address",
  phone_number: "pii_phone_number",
  payment_card: "pii_payment_card",
  ip_address: "pii_ip_address",
  credential: "pii_credential",
};

export const POST_FAILURE_REASON_CODES: Record<PostFailureCode, DeliveryReasonCode> = {
  call_failed: "post_call_failed",
  rejected: "post_rejected",
  not_authorised: "post_not_authorised",
  channel_unavailable: "post_channel_unavailable",
};

// The code a lane holds when a post did not reach the channel and no failure code explains
// it: a render that threw, a message the residual check could not read, a write that failed
// after the post landed.
export const NOT_DELIVERED_REASON_CODE: DeliveryReasonCode = "post_not_delivered";

function required(sentence: string | null, code: DeliveryReasonCode): string {
  if (sentence === null) {
    throw new Error(`delivery reason code ${code} has no sentence in @growthmind/shared`);
  }
  return sentence;
}

// One input, both outputs. A caller picks the code and reads the sentence back off it, so
// the pair a tick stores cannot be built from two switches that drift apart.
export const DELIVERY_REASON_SENTENCES: Record<DeliveryReasonCode, string> = {
  lane_posted: DELIVERY_LANE_DECISION_MESSAGES.posted,
  lane_failed: DELIVERY_LANE_DECISION_MESSAGES.failed,
  lane_blocked_by_pii: DELIVERY_LANE_DECISION_MESSAGES.blocked_by_pii,
  lane_nothing_today: DELIVERY_LANE_DECISION_MESSAGES.nothing_today,
  lane_not_claimed: DELIVERY_LANE_DECISION_MESSAGES.not_claimed,
  lane_not_connected: DELIVERY_LANE_DECISION_MESSAGES.not_connected,
  lane_unresolvable: DELIVERY_LANE_DECISION_MESSAGES.unresolvable,
  lane_errored: DELIVERY_LANE_DECISION_MESSAGES.lane_errored,

  quiet_one_already_open: NOTHING_TODAY_REASON_MESSAGES.one_already_open,
  quiet_no_findings_ready: NOTHING_TODAY_REASON_MESSAGES.no_findings_ready,
  quiet_budget_spent: NOTHING_TODAY_REASON_MESSAGES.budget_spent,

  pii_email_address: RESIDUAL_PII_KIND_MESSAGES.email_address,
  pii_phone_number: RESIDUAL_PII_KIND_MESSAGES.phone_number,
  pii_payment_card: RESIDUAL_PII_KIND_MESSAGES.payment_card,
  pii_ip_address: RESIDUAL_PII_KIND_MESSAGES.ip_address,
  pii_credential: RESIDUAL_PII_KIND_MESSAGES.credential,

  post_not_delivered: required(DELIVERY_STATUS_MESSAGES.failed, "post_not_delivered"),
  post_call_failed: deliveryFailureSentence("call_failed"),
  post_rejected: deliveryFailureSentence("rejected"),
  post_not_authorised: deliveryFailureSentence("not_authorised"),
  post_channel_unavailable: deliveryFailureSentence("channel_unavailable"),
};

export function deliveryReasonSentence(code: DeliveryReasonCode): string {
  return DELIVERY_REASON_SENTENCES[code];
}

export function laneDecisionReasonCode(decision: DeliveryLaneDecision): DeliveryReasonCode {
  return LANE_DECISION_REASON_CODES[decision];
}

export function nothingTodayReasonCode(reason: NothingTodayReason): DeliveryReasonCode {
  return NOTHING_TODAY_REASON_CODES[reason];
}

export function residualPiiReasonCode(kind: ResidualPiiKind): DeliveryReasonCode {
  return RESIDUAL_PII_REASON_CODES[kind];
}

export function postFailureReasonCode(code: PostFailureCode): DeliveryReasonCode {
  return POST_FAILURE_REASON_CODES[code];
}
