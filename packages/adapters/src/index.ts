export type { SessionSource } from "./session-source";

export { createPostHogSessionSource } from "./posthog/session-source";
export { POSTHOG_SOURCE_KIND } from "./posthog/constants";
export type { PostHogSourceConfig, PostHogSourceDeps, FetchLike } from "./posthog/deps";

// The key travels in on `DiscoveryInput` and is never returned, logged, or folded into a
// failure message.
export { discoverProjects } from "./posthog/discovery";
export type { DiscoveredProject, DiscoveryInput, DiscoveryResult } from "./posthog/discovery";

export {
  scrubSecrets,
  truncateForReason,
  POSTHOG_KEY_PATTERN,
  REDACTED_PLACEHOLDER,
  REASON_MAX_LENGTH,
} from "./http/scrub";

export { createSlackDeliveryPoster } from "./slack/poster";
export {
  SLACK_POST_MESSAGE_URL,
  SLACK_OAUTH_ACCESS_URL,
  SLACK_CONVERSATIONS_LIST_URL,
  // Qualified: a bare `REQUEST_TIMEOUT_MS` here would collide in meaning with the
  // PostHog adapter's, which is a different budget for a different caller.
  REQUEST_TIMEOUT_MS as SLACK_REQUEST_TIMEOUT_MS,
} from "./slack/constants";
// `apps/web` declares no `zod` (WIRE-Z1), so the Slack response schemas live here and
// cross as plain TypeScript.
export {
  readSlackJsonBody,
  parseSlackOAuthAccess,
  parseSlackConversationsPage,
} from "./slack/envelopes";
export type {
  SlackEnvelope,
  SlackWorkspaceGrant,
  SlackConversation,
  SlackConversationsPage,
} from "./slack/envelopes";
export { listSlackConversations } from "./slack/conversations";
export type {
  SlackConversationsConfig,
  SlackConversationsDeps,
  ListSlackConversationsResult,
} from "./slack/conversations";
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

export { createSessionSummariser } from "./model/summariser";
export type { SessionSummariser, SummariseInput } from "./model/summariser";
export { createRecordingNarrator, describeDuration } from "./model/narrator";
export type { RecordingNarrator, NarrateInput } from "./model/narrator";
export { DEFAULT_COLDSTART_MODEL } from "./model/constants";

export type { ReplayPullOptions, ReplaySource } from "./replay-source";

export { createRrwebReplaySource } from "./rrweb/replay-source";
export { RRWEB_SOURCE_KIND } from "./rrweb/constants";
export type { RrwebSourceConfig, RrwebSourceDeps } from "./rrweb/deps";

export { createPostHogReplaySource } from "./posthog/replay-source";
export { POSTHOG_REPLAY_SOURCE_KIND } from "./posthog/constants";

export { createColdstartModel } from "./model/provider";
export type { ColdstartModelConfig } from "./model/provider";
export {
  mapSummaryError,
  summaryFailure,
  SUMMARY_FAILURE_MESSAGES,
  UNCLASSIFIED_SUMMARY_ERROR_CODE,
} from "./model/errors";
export type { SummaryFailureArgs } from "./model/errors";
export type { SummariserDeps, SummaryOutput } from "./model/deps";

export {
  fetchSite,
  originOf,
  disallowedPaths,
  isAllowed,
  textOf,
  SITE_PAGE_LIMIT,
  SITE_BYTE_LIMIT,
  SITE_TIMEOUT_MS,
  SITE_TEXT_LIMIT,
  SITE_PATHS,
  type FetchedPage,
  type SiteFetch,
  type SiteFetchDeps,
  type SiteFetchResult,
  type SiteFetchFailure,
} from "./site/fetch";

export {
  createBusinessResearcher,
  type ReadFact,
  type BusinessReadOutput,
  type AudienceReductionResult,
  type BusinessReadResult,
  type BusinessResearcherDeps,
} from "./site/researcher";
