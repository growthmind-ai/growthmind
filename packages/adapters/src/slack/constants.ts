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
