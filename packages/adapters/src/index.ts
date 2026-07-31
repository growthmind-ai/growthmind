// @growthmind/adapters — outbound ports and their vendor implementations.
//
// Nothing credential-bearing is exported from here. The port's own shapes all
// live in @growthmind/shared, so a consumer that only needs a shape does not
// need this package at all — which is what keeps packages/db free of any
// dependency on it (the connection service injects its source factory).
export type { SessionSource } from "./session-source";

export { createPostHogSessionSource } from "./posthog/session-source";
export { POSTHOG_SOURCE_KIND } from "./posthog/constants";
export type { PostHogSourceConfig, PostHogSourceDeps, FetchLike } from "./posthog/deps";

// CR-6: credential scrubbing (FR-7's pattern-based redaction), so `packages/db`
// and `worker/` can apply the same guard to a reason/log string they build
// from this adapter's output instead of re-implementing a weaker one inline.
export {
  scrubSecrets,
  truncateForReason,
  POSTHOG_KEY_PATTERN,
  REDACTED_PLACEHOLDER,
  REASON_MAX_LENGTH,
} from "./posthog/scrub";

// --- O-007: the Slack delivery poster ---------------------------------------
// `FetchLike` is deliberately NOT re-exported here — the barrel already exports
// that name from ./posthog/deps, and the Slack module's copy is module-local so
// one platform type never gets two names.
export { createSlackDeliveryPoster } from "./slack/poster";
export { SLACK_POST_MESSAGE_URL } from "./slack/constants";
export {
  mapSlackError,
  postFailure,
  UNCLASSIFIED_SLACK_ERROR_CODE,
  SLACK_ERRORS_NOT_AUTHORISED,
  SLACK_ERRORS_CHANNEL_UNAVAILABLE,
  SLACK_ERRORS_REJECTED,
  SLACK_ERRORS_CALL_FAILED,
} from "./slack/errors";
export type { SlackPosterConfig, SlackPosterDeps } from "./slack/deps";
