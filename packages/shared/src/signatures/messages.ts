import type { SuppressionReasonCode } from "./types";

export const SUPPRESSION_REASON_MESSAGES: Record<SuppressionReasonCode, string | null> = {
  dismissed:
    "Someone on your team marked this as not useful, so we are leaving it out from now on. You can change that if you want it back.",

  already_delivered: "We have already told you about this one, so we are not sending it again.",

  not_seen_before: null,
  seen_not_delivered: null,

  unresolvable_ancestry:
    "We could not work out whether this is something we have told you about before, so we held it back rather than risk saying the same thing twice. Nothing was posted about it.",

  unknown_shape_version:
    "This came through in a form this version of Growthmind does not know how to read yet, so we could not tell whether it was new. Nothing was posted about it.",
};

export const ALL_SUPPRESSION_REASON_MESSAGES: readonly string[] = Object.values(
  SUPPRESSION_REASON_MESSAGES,
).filter((message): message is string => message !== null);

export const FORBIDDEN_PRODUCT_JARGON = [
  "signature",
  "ledger",
  "suppression",
  "policy",
  "candidate",
  "dedup",
  "hash",
] as const;
