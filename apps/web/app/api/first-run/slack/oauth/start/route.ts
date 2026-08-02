// `slackOAuthRedirectUri(env)` reads `BETTER_AUTH_URL` and never `Host`,
// `X-Forwarded-Host`, `Origin` or the request url: a caller-chosen callback is
// an open redirect, and the code it captures seals a bot token into this org.
// AD-6: an installation with no Slack app is refused here, in our own words,
// rather than redirected into a consent screen built with no client id.
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

export const inputSchema = firstRunSlackOAuthStartInputSchema;

export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  const env = parseServerEnv(process.env);

  const credentials = resolveSlackOAuthCredentials(env);
  if (credentials === null) return refusalResponse(SLACK_APP_UNAVAILABLE);

  // Read once: `expiresAt` and the cookie's `Max-Age` must share one instant.
  const now = deps.now();
  const state = signOAuthState(
    { identity: { userId: gate.ctx.userId, organizationId: gate.ctx.organizationId } },
    { secret: env.BETTER_AUTH_SECRET, now: () => now, nonce: () => randomUUID() },
  );

  const authorize = new URL(SLACK_AUTHORIZE_URL);
  authorize.searchParams.set("client_id", credentials.clientId);
  // Never trim: without `chat:write` granted here, the workspace connects, lists, and can never post.
  authorize.searchParams.set("scope", SLACK_OAUTH_SCOPE_PARAM);
  authorize.searchParams.set("redirect_uri", slackOAuthRedirectUri(env));
  authorize.searchParams.set("state", state.stateParameter);

  return new Response(null, {
    status: 302,
    headers: {
      location: authorize.href,
      "set-cookie": slackOAuthStateCookie(state, now),
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
