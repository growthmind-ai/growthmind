import type { ForbiddenReason } from "../growth/types";
import type { PostFailureCode } from "./poster";
import type {
  DeliveryDecision,
  DeliveryLaneDecision,
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

// What HAPPENED on one failed post attempt — facts only, never next actions. Each
// surface has a different repair: `channel_unavailable` once ended "pick another
// one", and the first-run card appended a clause contradicting it.
export const POST_FAILURE_MESSAGES: Record<PostFailureCode, string> = {
  call_failed:
    "We could not get this into Slack just now. Nothing about what we found has changed, and we will try again.",

  rejected:
    "Slack would not accept this message as we built it, so it has not arrived. Sending the same thing again would not help. Nothing about what we found has changed.",

  not_authorised:
    "Slack is no longer letting us post on your behalf, so someone will need to reconnect it before anything can arrive. Nothing about what we found has changed.",

  channel_unavailable:
    "We could not post to the channel that was chosen — it may have been archived or deleted, or we may no longer be in it. Nothing about what we found has changed.",
};

// The lane's own next action, per code. Total over the union on purpose, so a
// fifth code forces a decision here. Not "pick another one" — `attachChannel`
// never moves a chosen address, so re-pointing is an act no surface serves.
export const DELIVERY_LANE_FAILURE_CLAUSE: Record<PostFailureCode, string | null> = {
  call_failed: null,
  rejected: null,
  not_authorised: null,
  channel_unavailable:
    "Someone has to make that channel reachable again in Slack — unarchive it, or invite the bot back in. We will keep trying.",
};

// Composed here so no sentence exists outside `ALL_DELIVERY_MESSAGES` (D11), and
// from the code, never `PostResult.message` — the closed union is the redaction
// argument: a Slack response body has no parameter to travel through.
export function deliveryFailureSentence(code: PostFailureCode): string {
  const fact = POST_FAILURE_MESSAGES[code];
  const clause = DELIVERY_LANE_FAILURE_CLAUSE[code];

  return clause === null ? fact : `${fact} ${clause}`;
}

// What a tick concluded about one lane, in the words the record shows a founder. Every
// sentence a decision row can carry is one of these or one of the constants above — nothing
// derived from an exception or a vendor response ever becomes a stored reason.
export const DELIVERY_LANE_DECISION_MESSAGES: Record<DeliveryLaneDecision, string> = {
  posted: "We sent this one to your channel.",

  failed: "We could not get this into Slack. We will try again.",

  blocked_by_pii:
    "Part of what we were about to send looked like personal data, so we held it back rather than post it.",

  nothing_today: NOTHING_TODAY_LEAD,

  not_claimed:
    "Another run was already delivering this one, so this run left it alone. Nothing was missed.",

  not_connected:
    "There is no channel connected, so there was nowhere to send anything. Connect one and we will start again from here.",

  unresolvable:
    "We chose something to send and then could not find it again, so nothing went out. This is our problem to fix, not yours.",

  lane_errored:
    "Something went wrong on our side while we were working out what to send, so nothing went out. We will try again on the next run.",
};

export const FIX_QUEUED_ACKNOWLEDGEMENT =
  "Right — this one is queued for your coding agent. Ask it to work on your open fixes.";

// Said on a second press, never on a repeated delivery of one press: the interactivity
// route separates the two on the payload's identity.
export const FIX_ALREADY_QUEUED_ACKNOWLEDGEMENT =
  "Already queued. Ask your coding agent to work on your open fixes.";

export const DISMISSAL_ACKNOWLEDGEMENT = "Right — nobody on this team will see this one again.";

// Said on a second press, mirroring FIX_ALREADY_QUEUED_ACKNOWLEDGEMENT's split.
export const DISMISSAL_ALREADY_RECORDED_ACKNOWLEDGEMENT =
  "Already dismissed. Nobody on this team will see it.";

export const FIX_DETAIL_MISSING_REFUSAL =
  "This one was found before we started keeping the detail a coding agent needs. The next check will produce one that works.";

// Product decisions §5. The refusal is the fix, never the finding.
export const FIX_SURFACE_FORBIDDEN_REFUSALS: Record<ForbiddenReason, string> = {
  pricing_or_billing:
    "This is on a page where you take money, so we will not put a coding agent on it. What we found still stands — this change is yours to make.",
  auth: "This is on a sign-in page, so we will not put a coding agent on it. What we found still stands — this change is yours to make.",
  consent_or_terms:
    "This is on a page covering consent or terms, so we will not put a coding agent on it. What we found still stands — this change is yours to make.",
};

export const SLACK_INTERACTION_UNCONFIGURED_REFUSAL =
  "Slack is not finished being connected here yet, so this button cannot do anything. Whoever set Slack up can finish that, and then pressing it will work.";

// Matched structurally by `DeliveryVocabulary` in `packages/core` (arrow is one-way).
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
      FIX_QUEUED_ACKNOWLEDGEMENT,
      FIX_ALREADY_QUEUED_ACKNOWLEDGEMENT,
      DISMISSAL_ACKNOWLEDGEMENT,
      DISMISSAL_ALREADY_RECORDED_ACKNOWLEDGEMENT,
      FIX_DETAIL_MISSING_REFUSAL,
      SLACK_INTERACTION_UNCONFIGURED_REFUSAL,
      ...Object.values(FIX_SURFACE_FORBIDDEN_REFUSALS),
      ...Object.values(DELIVERY_DECISION_MESSAGES),
      ...Object.values(DELIVERY_LANE_DECISION_MESSAGES),
      ...Object.values(NOTHING_TODAY_REASON_MESSAGES),
      ...Object.values(DELIVERY_STATUS_MESSAGES),
      ...Object.values(RESIDUAL_PII_KIND_MESSAGES),
      ...Object.values(POST_FAILURE_MESSAGES),
      // Scanned as themselves: a composed sentence is not a fixed constant.
      ...Object.values(DELIVERY_LANE_FAILURE_CLAUSE),
    ].filter((message): message is string => message !== null),
  ),
];
