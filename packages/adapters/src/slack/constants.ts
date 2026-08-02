// All three urls are hardcoded — no customer-supplied host, so no SSRF guard is needed, an
// authorization code can never be posted somewhere a request names, and the conversations
// cursor rides as a query param rather than as a url Slack hands back.
export const SLACK_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";

export const SLACK_OAUTH_ACCESS_URL = "https://slack.com/api/oauth.v2.access";

export const SLACK_CONVERSATIONS_LIST_URL = "https://slack.com/api/conversations.list";

// Per-request ceiling: a host that accepts and never answers must not hold a delivery tick.
export const REQUEST_TIMEOUT_MS = 10_000;

export const MAX_RESPONSE_BYTES = 64 * 1024;
