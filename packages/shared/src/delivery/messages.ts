import type { PostFailureCode } from "./poster";
import type {
  DeliveryDecision,
  DeliveryStatus,
  NothingTodayReason,
  ResidualPiiKind,
} from "./types";

export const NOTHING_TODAY_LEAD =
  "We looked at what happened in your product, and we are not sending you anything today.";

export const DELIVERY_DECISION_MESSAGES: Record<DeliveryDecision, string | null> = {
  deliver: null,

  nothing_today: NOTHING_TODAY_LEAD,
};

export const NOTHING_TODAY_REASON_MESSAGES: Record<NothingTodayReason, string> = {
  one_already_open:
    "The last thing we sent is still waiting on an answer, and we only keep one of those open at a time. Once it is answered we will move on to the next one.",

  no_findings_ready:
    "We checked what happened and nothing was solid enough for us to put in front of you yet. We would rather stay quiet than send you something we cannot stand behind.",

  budget_spent:
    "We have already sent everything we will send for now. Nothing is wrong — we hold back on purpose so that what does arrive is worth reading.",
};

export const DELIVERY_STATUS_MESSAGES: Record<DeliveryStatus, string | null> = {
  pending: "We are posting this to Slack now.",

  posted: null,

  failed:
    "We could not get this into Slack. Nothing about what we found has changed, and we will try again.",
};

export const RESIDUAL_PII_KIND_MESSAGES: Record<ResidualPiiKind, string> = {
  email_address:
    "Part of this looked like an email address, so we held the post back rather than put it in a shared channel.",
  phone_number:
    "Part of this looked like a phone number, so we held the post back rather than put it in a shared channel.",
  payment_card:
    "Part of this looked like a payment card or account number, so we held the post back rather than put it in a shared channel.",
  ip_address:
    "Part of this looked like a network address, so we held the post back rather than put it in a shared channel.",
  credential:
    "Part of this looked like a key or password, so we held the post back rather than put it in a shared channel.",
};

export const NO_RATE_SENTENCE =
  "Every session we looked at was set aside, so there is no share to report.";

export const POST_FAILURE_MESSAGES: Record<PostFailureCode, string> = {
  call_failed:
    "We could not get this into Slack just now. Nothing about what we found has changed, and we will try again.",

  rejected:
    "Slack would not accept this message as we built it, so it has not arrived. Sending the same thing again would not help. Nothing about what we found has changed.",

  not_authorised:
    "Slack is no longer letting us post on your behalf, so someone will need to reconnect it before anything can arrive. Nothing about what we found has changed.",

  channel_unavailable:
    "We could not post to the channel that was chosen — it may have been archived or deleted, or we may no longer be in it. Someone will need to pick another one. Nothing about what we found has changed.",
};

export const DELIVERY_VOCABULARY = {
  nothingTodayLead: NOTHING_TODAY_LEAD,
  nothingToday: NOTHING_TODAY_REASON_MESSAGES,
  noRate: NO_RATE_SENTENCE,
} as const;

export const ALL_DELIVERY_MESSAGES: readonly string[] = [
  ...new Set(
    [
      NOTHING_TODAY_LEAD,
      NO_RATE_SENTENCE,
      ...Object.values(DELIVERY_DECISION_MESSAGES),
      ...Object.values(NOTHING_TODAY_REASON_MESSAGES),
      ...Object.values(DELIVERY_STATUS_MESSAGES),
      ...Object.values(RESIDUAL_PII_KIND_MESSAGES),
      ...Object.values(POST_FAILURE_MESSAGES),
    ].filter((message): message is string => message !== null),
  ),
];
