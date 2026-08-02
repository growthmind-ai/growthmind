// State is verified BEFORE the code is exchanged: a mismatch must cost zero
// outbound calls, observable only as the absence of a request to Slack.
// Every exit is a redirect to /first-run — failures included, cookie cleared on
// all of them — because a browser lands here, not a script.
import {
  createSlackConnectionsRepo,
  ensureProject,
  SlackConnectionWriteError,
  slackCredentialAad,
} from "@growthmind/db";
import {
  describeError,
  encryptSecret,
  firstRunSlackOAuthCallbackInputSchema,
  keyIdOf,
  logger,
  parseServerEnv,
  resolveCredentialKey,
} from "@growthmind/shared";

import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";
import { readRequestBody, refuseBody } from "@/lib/first-run/gate";
import { firstRunLandingFor, type SlackOAuthOutcome } from "@/lib/first-run/slack-oauth-outcome";
import {
  clearedSlackOAuthStateCookie,
  exchangeCode,
  resolveSlackOAuthCredentials,
  slackOAuthRedirectUri,
  slackOAuthStateCookieOf,
  verifyOAuthState,
  type OAuthStateRefusalCode,
} from "@/lib/slack/oauth";

export const dynamic = "force-dynamic";

/** Empty by design: `code` and `state` arrive as query parameters. */
export const inputSchema = firstRunSlackOAuthCallbackInputSchema;

/** The partial index on `(organization_id) WHERE is_active` is the only unique
 * index this insert can trip, so a violation is the second-workspace case. */
const UNIQUE_VIOLATION = "23505";
const ACTIVE_ORG_INDEX = "slack_connections_active_org_uidx";

function isSecondActiveConnection(error: SlackConnectionWriteError): boolean {
  return (
    error.constraint === ACTIVE_ORG_INDEX ||
    error.code === UNIQUE_VIOLATION ||
    error.message.includes(ACTIVE_ORG_INDEX)
  );
}

function outcomeOfStateRefusal(code: OAuthStateRefusalCode): SlackOAuthOutcome {
  return code === "state_expired" ? "expired" : "failed";
}

const land = (outcome: SlackOAuthOutcome): Response =>
  new Response(null, {
    status: 302,
    headers: {
      location: firstRunLandingFor(outcome),
      "set-cookie": clearedSlackOAuthStateCookie(),
    },
  });

export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const env = parseServerEnv(process.env);

  const ctx = await deps.tenant();
  if (ctx === null) return land("failed");

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  const url = new URL(request.url);

  const verdict = verifyOAuthState(
    {
      cookieValue: slackOAuthStateCookieOf(request.headers.get("cookie")),
      stateParameter: url.searchParams.get("state"),
      expected: { userId: ctx.userId, organizationId: ctx.organizationId },
    },
    { secret: env.BETTER_AUTH_SECRET, now: deps.now },
  );
  if (!verdict.ok) return land(outcomeOfStateRefusal(verdict.code));

  if (url.searchParams.get("error") !== null) return land("declined");

  const code = url.searchParams.get("code");
  if (code === null || code.length === 0) return land("failed");

  const credentials = resolveSlackOAuthCredentials(env);
  if (credentials === null) return land("unavailable");

  const resolution = deps.credentialKey ?? resolveCredentialKey(env);
  if (!resolution.ok) return land("unavailable");

  const exchanged = await exchangeCode(code, {
    fetch: deps.fetch ?? globalThis.fetch,
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    // Byte-identical to the authorize request's, or Slack refuses the exchange.
    redirectUri: slackOAuthRedirectUri(env),
  });
  if (!exchanged.ok) return land("failed");

  await ensureProject(deps.db, ctx);

  try {
    await createSlackConnectionsRepo(deps.db, ctx).insertActive({
      // AD-4: half-connected on purpose — the channel is the next screen.
      channelId: null,
      // Persisted deliberately: `workspaceName` is OPTIONAL on the insert input,
      // so dropping `teamName` typechecks and only the rendered sentence goes missing.
      workspaceName: exchanged.teamName ?? null,
      credentialCiphertext: encryptSecret(
        exchanged.botToken,
        resolution.key,
        // Bound to the owning organization: a ciphertext lifted from another
        // organization's row fails authentication rather than decrypting.
        slackCredentialAad(ctx),
      ),
      credentialKeyId: keyIdOf(resolution.key),
      connectedByUserId: ctx.userId,
      connectedAt: deps.now(),
    });
  } catch (error) {
    if (error instanceof SlackConnectionWriteError && isSecondActiveConnection(error)) {
      return land("already-connected");
    }

    // Not a catch-all: a re-throw would exit without `land()`, after the code is burned.
    logger.error("first-run slack oauth callback: the connection row could not be written", {
      organizationId: ctx.organizationId,
      reason: describeError(error),
    });

    return land("failed");
  }

  return land("connected");
}

export async function GET(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
