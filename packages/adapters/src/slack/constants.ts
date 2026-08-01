// Fixed values for the Slack delivery adapter.
//
// Everything here is a compile-time constant. Nothing in this adapter builds a url out
// of stored state, a cursor, or a customer-supplied value, which is precisely why it
// needs none of the ssrf machinery `../posthog/host-guard.ts` exists for. The PostHog
// walk follows a `next` cursor the remote hands it, so its origin must be re-checked on
// every hop; there is one endpoint here and the remote never gets to name it.

/**
 * The one endpoint this adapter calls.
 *
 * Deliberately not configurable. A base url read from configuration would be a
 * server-side-request surface reachable from a stored row (the exact hole
 * `host-guard.ts` was written to close), and it would buy nothing: a customer
 * self-hosting Growthmind still talks to Slack's own API. A Slack-compatible server is
 * a different adapter, not a different string.
 */
export const SLACK_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";

/**
 * The token exchange at the end of the "Add to Slack" round trip (AD-5).
 *
 * Fixed for the same reason `SLACK_POST_MESSAGE_URL` is. A configurable exchange
 * endpoint would be a server-side-request surface that an authorization code could be
 * posted to — and the code seals a bot token into an organization, so the one value
 * that must never be sent somewhere a request can name is exactly this one.
 */
export const SLACK_OAUTH_ACCESS_URL = "https://slack.com/api/oauth.v2.access";

/**
 * The channel list a founder picks their delivery destination from (AD-7).
 *
 * Fixed, and the pagination cursor is carried as a QUERY PARAMETER on this url rather
 * than as a url Slack hands back — so the "follow the `next` link verbatim" hazard
 * `../posthog/client.ts` re-checks its origin for does not arise here at all. The
 * remote never gets to name a host.
 */
export const SLACK_CONVERSATIONS_LIST_URL = "https://slack.com/api/conversations.list";

/**
 * Per-request ceiling.
 *
 * Without it, a host that accepts the connection and never answers holds a worker slot
 * open for as long as the runtime allows, the same hazard `../posthog/constants.ts`
 * names. Ten seconds is generous for a single small POST and short enough that a hung
 * Slack does not consume a delivery tick.
 */
export const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Ceiling on the response body we will read.
 *
 * A `chat.postMessage` reply is a few hundred bytes. This is not a defence against
 * Slack; it is a defence against whatever is actually on the other end of the socket
 * when DNS, a proxy, or a captive portal is having a bad day. An HTML error page
 * streamed forever would otherwise be read into memory in full.
 */
export const MAX_RESPONSE_BYTES = 64 * 1024;
