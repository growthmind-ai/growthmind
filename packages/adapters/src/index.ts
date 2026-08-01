// @growthmind/adapters, outbound ports and their vendor implementations.
//
// Nothing credential-bearing is exported from here. The port's own shapes all live in
// @growthmind/shared, so a consumer that only needs a shape does not need this package
// at all, which is what keeps packages/db free of any dependency on it (the connection
// service injects its source factory).
export type { SessionSource } from "./session-source";

export { createPostHogSessionSource } from "./posthog/session-source";
export { POSTHOG_SOURCE_KIND } from "./posthog/constants";
export type { PostHogSourceConfig, PostHogSourceDeps, FetchLike } from "./posthog/deps";

// Credential scrubbing (the pattern-based redaction), so `packages/db` and `worker/`
// can apply the same guard to a reason/log string they build from this adapter's output
// instead of re-implementing a weaker one inline.
export {
  scrubSecrets,
  truncateForReason,
  POSTHOG_KEY_PATTERN,
  REDACTED_PLACEHOLDER,
  REASON_MAX_LENGTH,
} from "./posthog/scrub";

// --: the Slack delivery poster `FetchLike` is deliberately not re-exported here. The
// barrel already exports that name from ./posthog/deps, and the Slack module's copy is
// module-local so one platform type never gets two names.
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

// --: the model lane's summariser The `ai` / `@ai-sdk/anthropic` dependency is declared
// only in this package and imported only under ./anthropic/. Nothing outside
// packages/adapters may reach the SDK. Consumers get this port and the shapes in
// @growthmind/shared.
export { createAnthropicSessionSummariser } from "./anthropic/summariser";
export type { SessionSummariser, SummariseInput } from "./anthropic/summariser";
export { DEFAULT_COLDSTART_MODEL } from "./anthropic/constants";
// The provider constructor, exported so the composition root can build the
// `LanguageModel` the summariser takes without importing the SDK itself. The key
// travels one function call and is never exported back out: `AnthropicModelConfig`
// declares the field the caller fills in, exactly as `SlackPosterConfig` declares its
// bot token. A shape, never a credential.
export { createAnthropicModel } from "./anthropic/model";
export type { AnthropicModelConfig } from "./anthropic/model";
export {
  mapSummaryError,
  summaryFailure,
  SUMMARY_FAILURE_MESSAGES,
  UNCLASSIFIED_SUMMARY_ERROR_CODE,
} from "./anthropic/errors";
export type { SummaryFailureArgs } from "./anthropic/errors";
export type { AnthropicSummariserDeps, SummaryOutput } from "./anthropic/deps";
