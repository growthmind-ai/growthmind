// GET /api/first-run/slack/oauth/start — the door out to Slack's consent
// screen (AD-5, AD-6, AD-16, AD-16a).
//
// ###########################################################################
// # THIS ROUTE'S WHOLE ANSWER IS A REDIRECT, AND IT IS DELIBERATE.
// #
// # The consent screen belongs to Slack. Anything we render in front of it is
// # a screen a founder has to get past before the one that matters, so the
// # only thing between "Add to Slack" and Slack is a 302 — plus the one thing
// # that has to be minted before leaving: the signed state that makes the
// # return trip safe.
// #
// # EXCEPT WHEN THERE IS NO SLACK APP TO SEND ANYBODY TO (AD-6). A 302 into a
// # consent screen built with no client id is a dead end wearing a working
// # feature's clothes: the founder leaves the product, reads Slack's error
// # page about an app that does not exist, and has nowhere to go back to. So
// # the absence is refused HERE, in our own words, and never forwarded.
// ###########################################################################
//
// ── THE REDIRECT URI COMES FROM CONFIGURATION AND FROM NOTHING ELSE ─────────
//
// `slackOAuthRedirectUri(env)` reads `BETTER_AUTH_URL`. It never reads `Host`,
// `X-Forwarded-Host`, `Origin`, or the request's own URL — all four are
// caller-controlled, and a callback address a caller can choose is an open
// redirect that hands Slack's authorization code to whoever chose it. That code
// seals a bot token into THIS organization, so the open redirect is not a
// phishing nuisance here; it is a workspace takeover.
//
// ── THE SCOPES ARE IMPORTED, NEVER SPELLED ──────────────────────────────────
//
// `SLACK_OAUTH_SCOPE_PARAM` is derived from the same array
// `apps/web/lib/slack/channels.ts` documents, and `chat:write` is in it. Scopes
// are granted at authorize time, so a start route that trimmed the string to
// the two read scopes would produce a workspace that connects, lists channels,
// and can never post — recoverable only through a re-consent this product has
// no screen for (D9).
import { firstRunSlackOAuthStartInputSchema, parseServerEnv } from "@growthmind/shared";
import { randomUUID } from "node:crypto";

import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";
import { readRequestBody, refuseBody, requireTenant } from "@/lib/first-run/gate";
import { refusalResponse, SLACK_APP_UNAVAILABLE } from "@/lib/first-run/refusals";
import { SLACK_OAUTH_SCOPE_PARAM } from "@/lib/slack/channels";
import {
  resolveSlackOAuthCredentials,
  signOAuthState,
  slackOAuthRedirectUri,
  slackOAuthStateCookie,
  SLACK_AUTHORIZE_URL,
} from "@/lib/slack/oauth";

export const dynamic = "force-dynamic";

/** `z.strictObject({})` — nothing a caller sends may influence where this route
 * sends them, and a key sent anyway is refused by name rather than stripped. */
export const inputSchema = firstRunSlackOAuthStartInputSchema;

export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  // NO `ensureProject`. This route attaches nothing, reads nothing of ours and
  // writes nothing — it mints a value and points a browser at a vendor. The
  // same reasoning `analytics/discover` gives for leaving the row alone: a
  // project row minted as a side effect of a redirect is a trace of a setup
  // attempt that may be abandoned on Slack's own screen.
  const env = parseServerEnv(process.env);

  // AD-6, BEFORE ANY STATE IS SIGNED. A cookie handed out here would be one
  // half of a pair whose other half can never be redeemed, and the founder
  // would carry it around for ten minutes for nothing.
  const credentials = resolveSlackOAuthCredentials(env);
  if (credentials === null) return refusalResponse(SLACK_APP_UNAVAILABLE);

  // BOTH FIELDS, NEVER JUST THE USER (AD-5). A founder who belongs to two
  // organizations could otherwise have a state signed while acting in one and
  // redeemed while acting in the other — a same-person, wrong-tenant write.
  //
  // `randomUUID` rather than `Math.random`: the nonce is what stops one state
  // per founder per clock tick being replayable by anybody who saw the url.
  //
  // THE CLOCK IS READ ONCE AND THEN HELD. The signer's `expiresAt` and the
  // cookie's `Max-Age` are computed from the same instant on purpose — two
  // reads of a real clock differ, and a cookie that outlives the value inside
  // it produces `state_expired` on a round trip the browser still believes in.
  const now = deps.now();
  const state = signOAuthState(
    { identity: { userId: gate.ctx.userId, organizationId: gate.ctx.organizationId } },
    { secret: env.BETTER_AUTH_SECRET, now: () => now, nonce: () => randomUUID() },
  );

  const authorize = new URL(SLACK_AUTHORIZE_URL);
  authorize.searchParams.set("client_id", credentials.clientId);
  authorize.searchParams.set("scope", SLACK_OAUTH_SCOPE_PARAM);
  authorize.searchParams.set("redirect_uri", slackOAuthRedirectUri(env));
  authorize.searchParams.set("state", state.stateParameter);

  // 302 rather than 307: this is a plain browser navigation with no method or
  // body to preserve, and it is the status every OAuth start in the wild uses.
  return new Response(null, {
    status: 302,
    headers: {
      location: authorize.href,
      // THE OTHER HALF OF THE PAIR. httpOnly so no script on any page of this
      // app can read the value that authorises a workspace to be attached to
      // this organization; SameSite=Lax so a third-party page cannot cause the
      // round trip to be walked with the victim's cookie attached.
      "set-cookie": slackOAuthStateCookie(state, now),
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
