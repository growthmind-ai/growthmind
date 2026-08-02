// Failure mapping at the Slack boundary, the same job `../posthog/errors.ts` does for
// the other adapter and built the same way: the vendor's own error text is read only to
// select a code, and the sentence a human eventually reads comes from a fixed table in
// this file.
//
// Why the shape of this file is the redaction guarantee
// `packages/shared/src/delivery/poster.ts` hands this adapter an inherited obligation,
// worded there and again on `summaryFailureCodeSchema`: Slack's own error text must
// never reach `PostResult.message` verbatim, because a Slack error can carry channel
// ids, team ids, user ids and request-identifying detail, and `z.string` accepts
// every one of them silently.
//
// The obligation is met structurally rather than by scrubbing. `mapSlackError` returns
// a `PostFailureCode` and nothing else. The Slack string is consumed entirely by an
// `includes` test, and `postFailure` builds its message from a `Record<PostFailureCode,
// string>` of four hand-written sentences. There is therefore no expression anywhere in
// this module by which a byte of Slack's response could reach a returned `message`,
// whatever the response contains. That is a stronger guarantee than the PostHog
// adapter's belt-and-braces `scrubSecrets` pass, which exists there because that
// adapter holds a customer credential the upstream can echo back; the test in
// `__tests__/slack/poster.test.ts` proves it by asserting that every message this
// package can produce is one of exactly four fixed strings.
//
// Where the sentences live In `packages/shared/src/delivery/messages.ts`, as
// `POST_FAILURE_MESSAGES`, imported below, not in this file. That module is the
// delivery lane's one home for customer-facing strings and the place
// `ALL_DELIVERY_MESSAGES` runs its plain-English audit; four sentences sitting outside
// that aggregate is precisely the drift it exists to prevent. Same relationship the
// PostHog sibling has with `CONNECT_REFUSAL_MESSAGES`: the adapter maps to a code, and
// imports the words.
//
// The redaction guarantee is untouched by that move. It never rested on where the
// sentences were written, only on `postFailure` taking a closed union and nothing else.
import { POST_FAILURE_MESSAGES } from "@growthmind/shared";
import type { PostFailureCode, PostResult } from "@growthmind/shared";

// Slack's documented `chat.postMessage` errors, grouped by what a human would have to
// do about them, which is the split `postFailureCodeSchema` makes, and is not the same
// as the split Slack's own naming makes.
//
// Only documented codes are listed. Nothing is added on a guess, for the reason
// `../posthog/errors.ts` gives for coding no 403 branch: a branch written on a hunch is
// a branch nobody can debug when it fires. Anything absent from all four groups takes
// the safe default at the bottom of this file.

/**
 * Not retryable. Our credentials are refused or insufficient, and every retry from now
 * until a human reconnects Slack will be refused identically. A lane that retried these
 * would burn its budget forever while hiding the one problem the customer could
 * actually fix.
 */
export const SLACK_ERRORS_NOT_AUTHORISED: readonly string[] = [
  "invalid_auth",
  "not_authed",
  "account_inactive",
  "token_revoked",
  "token_expired",
  "missing_scope",
  "no_permission",
];

/**
 * Not retryable. The destination is gone, archived, or was never joined. Kept apart from
 * `not_authorised` because the repair is a different one — get us back into that
 * channel, not reconnect the workspace — and telling a customer to do the wrong one of
 * those two costs them a support round-trip.
 *
 * The repair itself is NOT written into `POST_FAILURE_MESSAGES`, only the fact.
 * `chat.postMessage` failing this way means the same thing everywhere, but what somebody
 * should do about it does not: a scheduled delivery and a first-run test post have
 * different controls in front of them. Each surface composes its own clause.
 */
export const SLACK_ERRORS_CHANNEL_UNAVAILABLE: readonly string[] = [
  "channel_not_found",
  "is_archived",
  "not_in_channel",
];

/**
 * Not retryable unchanged. Slack read the payload and refused its shape. The next
 * attempt with the same bytes gets the same answer, so this is a bug in what we
 * rendered, and the delivery lane should surface it rather than orbit it.
 */
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

/**
 * Retryable. Slack is up but could not serve this call right now. Throttling or its own
 * fault. Nothing about the message or the connection is wrong, so the same request
 * later is expected to succeed.
 *
 * `Retry-After` on a 429 is deliberately not read: `PostResult` has nowhere to carry
 * it, and widening the port to pass a delay would move the pacing decision out of the
 * scheduler, which is the surface that actually knows the lane's budget.
 */
export const SLACK_ERRORS_CALL_FAILED: readonly string[] = [
  "ratelimited",
  "rate_limited",
  "fatal_error",
  "internal_error",
  "service_unavailable",
  "request_timeout",
];

/**
 * Where an error code we have never seen lands.
 *
 * `call_failed` (the retryable arm) and the direction is chosen deliberately (a
 * classifier's misses matter more than its hits). An unclassified code defaulting to a
 * terminal arm would silently strand a finding that a second attempt would have
 * delivered; defaulting to the retryable arm costs, at worst, a bounded number of
 * doomed retries scheduled by a caller that already bounds them, and the delivery row
 * still ends in a named `failed` state with a plain-English reason rather than a stuck
 * one.
 *
 * The message settles it independently. `call_failed`'s sentence claims only that the
 * attempt did not go through, which is exactly what an unknown code establishes.
 * `not_authorised`'s and `channel_unavailable`'s sentences each tell a customer to go
 * and change something; asserting either on the strength of a code we cannot classify
 * would be telling them to fix a thing we have no evidence is broken.
 */
export const UNCLASSIFIED_SLACK_ERROR_CODE: PostFailureCode = "call_failed";

/**
 * Maps Slack's `error` string onto the mechanism the caller can act on.
 *
 * The parameter is `string | undefined` because a `{ok:false}` body carrying no `error`
 * at all is a real shape (a proxy's rewrite, a truncated body), and it must land
 * somewhere named rather than crash the caller.
 *
 * NOTE the return type. This function cannot leak Slack's text, because it does not
 * return text. See the header. Nothing downstream re-reads its argument.
 */
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

// The four sentences now live in `packages/shared/src/delivery/messages.ts` as
// `POST_FAILURE_MESSAGES`, imported above. The inherited obligation this module handed
// forward, discharged. They belong in the delivery lane's one home because that is
// where `ALL_DELIVERY_MESSAGES` scans, and a customer-facing sentence outside the audit
// aggregate is the drift the aggregate exists to prevent. The redaction guarantee is
// unaffected: it never rested on where the sentences were written, only on
// `postFailure` below taking a closed union and nothing else.

/**
 * The only way this package builds a failed `PostResult`.
 *
 * One argument, and it is a closed union. That is the whole redaction argument in one
 * signature: there is no parameter here through which a response body, a url, a channel
 * id or a token could travel, so no caller can accidentally thread one in, not even by
 * trying.
 */
export function postFailure(code: PostFailureCode): Extract<PostResult, { ok: false }> {
  return { ok: false, code, message: POST_FAILURE_MESSAGES[code] };
}
