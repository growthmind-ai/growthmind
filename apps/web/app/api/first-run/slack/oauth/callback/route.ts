// GET /api/first-run/slack/oauth/callback — the return trip (AD-4, AD-5,
// AD-16, AD-16a, AD-20).
//
// ###########################################################################
// # THE STATE IS VERIFIED BEFORE THE CODE IS REDEEMED, AND THE ORDER IS THE
// # WHOLE SECURITY PROPERTY.
// #
// # An attacker completes Slack's consent screen against THEIR OWN workspace,
// # keeps the resulting `code`, and gets a signed-in victim's browser to open
// # this url with it. A callback that exchanges first and checks afterwards
// # has already sealed the attacker's bot token into the victim's
// # organization by the time it refuses — every finding this product writes
// # about the victim's funnel would post into a room the attacker owns, with
// # no error anywhere and the victim's screen saying "connected".
// #
// # "Refused before the exchange" is not observable from a status code. It is
// # observable only from the ABSENCE of a request to Slack, which is why the
// # suite counts outbound calls and why the fetch is injected (AD-8).
// ###########################################################################
//
// ── EVERY EXIT IS A REDIRECT, INCLUDING THE FAILURES ────────────────────────
//
// This is the one route on this surface a BROWSER LANDS ON rather than one
// script calls. A founder who arrives here and is handed `{"ok":false}` has
// been dropped outside the product with no way back — so both arms end on the
// onboarding surface, and the failure carries an outcome the page turns into a
// sentence (`@/lib/first-run/slack-oauth-outcome`). That includes the
// signed-out case, which is the one place this route departs from the surface's
// otherwise identical preamble: a session that expired during the consent
// screen is a founder mid-flow, and a 401 body is a dead end where a redirect
// into the sign-in page is a path back.
//
// ── THE SECOND WORKSPACE IS REFUSED BY THE CONSTRAINT, NEVER BY A READ ──────
//
// The partial unique index `slack_connections_active_org_uidx` settles it
// (EC-O6, D6): two members finishing consent in the same second cannot both
// win, and the loser learns it from Postgres rather than from a prior read
// another transaction has already invalidated. What reaches the founder is an
// outcome word, never a `23505` and never an index name.
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

/** `z.strictObject({})`. `code` and `state` arrive as QUERY parameters on a
 * browser redirect and are deliberately not declared as input: neither is a
 * field this surface accepts on trust, and a parse is not the check. */
export const inputSchema = firstRunSlackOAuthCallbackInputSchema;

/** Postgres' `unique_violation`. The partial index on `(organization_id) WHERE
 * is_active` is the only unique index an insert here can trip — the primary key
 * is a freshly generated uuid — so this class is exactly the second-workspace
 * case. Same three-way read as `slack/connect/route.ts`, whose own comment
 * explains why the name is checked as an identifier rather than parsed out of
 * prose (D9). */
const UNIQUE_VIOLATION = "23505";
const ACTIVE_ORG_INDEX = "slack_connections_active_org_uidx";

function isSecondActiveConnection(error: SlackConnectionWriteError): boolean {
  return (
    error.constraint === ACTIVE_ORG_INDEX ||
    error.code === UNIQUE_VIOLATION ||
    error.message.includes(ACTIVE_ORG_INDEX)
  );
}

/**
 * A refused state, as something a founder can be told.
 *
 * ONLY `state_expired` SURVIVES AS ITSELF. A slow founder — one who had to sign
 * into Slack first, choose between three workspaces, and read what they were
 * approving — did nothing wrong and pressing the button again works, so telling
 * them the round trip "failed" would be both false and unhelpful. The other
 * five are a forgery, a truncation, a hand-composed url or somebody else's
 * state, and the honest instruction for all of them is the same one: start
 * again. Naming which flavour of wrong it was on a founder's screen would tell
 * an attacker more than it tells them.
 */
function outcomeOfStateRefusal(code: OAuthStateRefusalCode): SlackOAuthOutcome {
  return code === "state_expired" ? "expired" : "failed";
}

/**
 * EVERY EXIT FROM THE HANDLER. The cookie is cleared on ALL of them: a state is
 * single-use, and one left in a browser after the round trip is settled is
 * exactly as redeemable to whoever finds it as it was before.
 *
 * At module scope, and it takes no configuration. It used to close over the
 * handler's `env` because the cleared cookie's `Secure` flag was derived from
 * `BETTER_AUTH_URL`; that derivation is gone (`@/lib/slack/oauth`,
 * `isSecurelyAddressed`, which cites `apps/web/lib/auth.ts:44-49`), so the
 * response depends on the outcome word and on nothing else.
 */
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

  // THE PREAMBLE, WITH ITS ONE DELIBERATE DEPARTURE — see this file's header.
  // `requireTenant` would answer a 401 JSON body, which is the right answer for
  // every route script calls and the wrong one for the route a browser lands
  // on. The page's own gate sends a signed-out visitor to sign in.
  const ctx = await deps.tenant();
  if (ctx === null) return land("failed");

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  const url = new URL(request.url);

  // FIRST, AND BEFORE ANYTHING LEAVES THIS PROCESS. `expected` is the identity
  // of the session that is calling: both fields, so a founder in two
  // organizations cannot have a state signed while acting in one and redeemed
  // while acting in the other (D7).
  const verdict = verifyOAuthState(
    {
      cookieValue: slackOAuthStateCookieOf(request.headers.get("cookie")),
      stateParameter: url.searchParams.get("state"),
      expected: { userId: ctx.userId, organizationId: ctx.organizationId },
    },
    { secret: env.BETTER_AUTH_SECRET, now: deps.now },
  );
  if (!verdict.ok) return land(outcomeOfStateRefusal(verdict.code));

  // THE FOUNDER SAID NO, AND THAT IS NOT A FAILURE. Slack echoes the state on
  // its denial redirect too, so this is checked after the state and before the
  // code — a founder who cancelled has no code, and reporting "we could not
  // complete it" for a choice they made would be a product arguing with them.
  if (url.searchParams.get("error") !== null) return land("declined");

  const code = url.searchParams.get("code");
  if (code === null || code.length === 0) return land("failed");

  // AD-6, checked here as well as at the start route: an installation whose
  // credentials were removed between the two halves of one round trip cannot
  // redeem anything, and an exchange with no client id would spend the code
  // for a refusal.
  const credentials = resolveSlackOAuthCredentials(env);
  if (credentials === null) return land("unavailable");

  // THE INHERITED INSECURE-DEFAULTS GATE, BEFORE THE EXCHANGE. An installation
  // that cannot seal a token safely must not obtain one: redeeming first would
  // burn the code and leave us holding a bot token with nowhere safe to put it.
  const resolution = deps.credentialKey ?? resolveCredentialKey(env);
  if (!resolution.ok) return land("unavailable");

  const exchanged = await exchangeCode(code, {
    fetch: deps.fetch ?? globalThis.fetch,
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    // BYTE-IDENTICAL TO THE ONE THE AUTHORIZE REQUEST CARRIED, or Slack refuses
    // the exchange. One producer, so the two cannot drift.
    redirectUri: slackOAuthRedirectUri(env),
  });
  if (!exchanged.ok) return land("failed");

  // FR-O1: the organization's project exists by the time any step runs, so no
  // route depends on another having been called first.
  await ensureProject(deps.db, ctx);

  try {
    await createSlackConnectionsRepo(deps.db, ctx).insertActive({
      // AD-4: HALF-CONNECTED ON PURPOSE. A workspace is attached and nothing
      // can be delivered yet — the channel is the next screen, not a field on
      // this one, and the nullable column is what lets that state exist.
      channelId: null,
      // GAP 1, CLOSED HERE RATHER THAN BY THE SIGNATURE.
      // `InsertActiveSlackConnectionInput.workspaceName` had to be optional so
      // a shipped test contract kept compiling, which means a callback that
      // read `team.name` and dropped it would typecheck and the only symptom
      // would be "Connected to {workspace}." never rendering — a textbook
      // severed wire (D11). The suite asserts this value is PERSISTED.
      workspaceName: exchanged.teamName ?? null,
      credentialCiphertext: encryptSecret(
        exchanged.botToken,
        resolution.key,
        // ONE PRODUCER, AND IT TAKES A CONTEXT. The envelope is bound to its
        // owning organization, so a ciphertext lifted from another
        // organization's row fails authentication rather than decrypting.
        slackCredentialAad(ctx),
      ),
      credentialKeyId: keyIdOf(resolution.key),
      // ATTRIBUTION, so the test post can name who connected it (OQ-O6). No
      // read anywhere ever narrows by it.
      connectedByUserId: ctx.userId,
      connectedAt: deps.now(),
    });
  } catch (error) {
    if (error instanceof SlackConnectionWriteError && isSecondActiveConnection(error)) {
      return land("already-connected");
    }

    // ANY OTHER WRITE FAILURE LANDS TOO, AND IT IS NOT A GENERIC CATCH-ALL —
    // it is what makes this file's header claim true. A re-throw exited the
    // handler WITHOUT `land()`, so the state cookie survived a settled round
    // trip on precisely the exits nobody planned for, and "cleared on ALL of
    // them" was conditional on the error class. The invariant has to be
    // structural: every path out of here goes through `land`.
    //
    // It is also the only route on this surface a BROWSER LANDS ON. A throw
    // becomes a Next.js 500 html page, shown AFTER the authorization code has
    // been burned — the founder is outside the product, on a page with no way
    // back, holding a code that can never be redeemed again. A redirect to the
    // onboarding surface with an outcome word is a path back; the page turns it
    // into a sentence (`@/lib/first-run/slack-oauth-outcome`).
    //
    // The diagnosis moves to the server log, which is where it belongs. The
    // founder is told the round trip failed and to start again — the honest
    // instruction either way — and never a constraint name, a driver code or a
    // stack. `describeError` because a `catch` binds `unknown` and a `pg` error
    // carries `.query` and `.parameters`; the message is what a person can act
    // on, the rest is the credential's own neighbourhood.
    console.error("first-run slack oauth callback: the connection row could not be written", {
      organizationId: ctx.organizationId,
      reason: describeError(error),
    });

    return land("failed");
  }

  // NOT "done". The workspace is attached; nothing arrives anywhere until a
  // channel is chosen, and the page's own blocker chain says so.
  return land("connected");
}

export async function GET(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
