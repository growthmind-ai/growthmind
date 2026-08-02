export type { SessionSource } from "./session-source";

export { createPostHogSessionSource } from "./posthog/session-source";
export { POSTHOG_SOURCE_KIND } from "./posthog/constants";
export type { PostHogSourceConfig, PostHogSourceDeps, FetchLike } from "./posthog/deps";

export {
  scrubSecrets,
  truncateForReason,
  POSTHOG_KEY_PATTERN,
  REDACTED_PLACEHOLDER,
  REASON_MAX_LENGTH,
} from "./posthog/scrub";

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

export { createAnthropicSessionSummariser } from "./anthropic/summariser";
export type { SessionSummariser, SummariseInput } from "./anthropic/summariser";
export { DEFAULT_COLDSTART_MODEL } from "./anthropic/constants";

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
