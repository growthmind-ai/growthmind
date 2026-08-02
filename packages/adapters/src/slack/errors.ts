import { POST_FAILURE_MESSAGES } from "@growthmind/shared";
import type { PostFailureCode, PostResult } from "@growthmind/shared";

export const SLACK_ERRORS_NOT_AUTHORISED: readonly string[] = [
  "invalid_auth",
  "not_authed",
  "account_inactive",
  "token_revoked",
  "token_expired",
  "missing_scope",
  "no_permission",
];

// Kept apart from `not_authorised`: the repair differs — get the bot back into the channel,
// not reconnect the workspace — and each surface composes that repair clause itself.
export const SLACK_ERRORS_CHANNEL_UNAVAILABLE: readonly string[] = [
  "channel_not_found",
  "is_archived",
  "not_in_channel",
];

export const SLACK_ERRORS_REJECTED: readonly string[] = [
  "invalid_blocks",
  "invalid_blocks_format",
  "msg_too_long",
  "no_text",
  "invalid_arguments",
  "invalid_arg_name",
  "invalid_attachments",
  "too_many_attachments",
];

export const SLACK_ERRORS_CALL_FAILED: readonly string[] = [
  "ratelimited",
  "rate_limited",
  "fatal_error",
  "internal_error",
  "service_unavailable",
  "request_timeout",
];

export const UNCLASSIFIED_SLACK_ERROR_CODE: PostFailureCode = "call_failed";

export function mapSlackError(slackError: string | undefined): PostFailureCode {
  if (slackError === undefined || slackError.length === 0) {
    return UNCLASSIFIED_SLACK_ERROR_CODE;
  }
  if (SLACK_ERRORS_NOT_AUTHORISED.includes(slackError)) {
    return "not_authorised";
  }
  if (SLACK_ERRORS_CHANNEL_UNAVAILABLE.includes(slackError)) {
    return "channel_unavailable";
  }
  if (SLACK_ERRORS_REJECTED.includes(slackError)) {
    return "rejected";
  }
  if (SLACK_ERRORS_CALL_FAILED.includes(slackError)) {
    return "call_failed";
  }
  return UNCLASSIFIED_SLACK_ERROR_CODE;
}

// Fixed sentences only: Slack's own error text never reaches a returned failure, and
// neither does the bot token.
export function postFailure(code: PostFailureCode): Extract<PostResult, { ok: false }> {
  return { ok: false, code, message: POST_FAILURE_MESSAGES[code] };
}
