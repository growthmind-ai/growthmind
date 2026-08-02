// THE "ADD TO SLACK" ROUND TRIP — the signed state that makes it safe, and the token
// exchange that ends it (AD-5, AD-6, AD-8).
//
// ###########################################################################
// # WHAT THE STATE IS FOR, IN THE ADD'S OWN WORDS (AD-5):
// #
// #   "CSRF is the whole point: without it, an attacker's `code` can be
// #    redeemed into the victim's org."
// #
// # An attacker completes Slack's consent screen against THEIR OWN workspace,
// # keeps the resulting `code`, and gets a signed-in victim's browser to open
// # the callback with it. If the callback exchanges that code, the attacker's
// # workspace becomes the VICTIM'S ORGANISATION'S delivery channel, and every
// # finding this product writes about the victim's funnel is posted into a room
// # the attacker owns. No error fires anywhere; the victim's screen says
// # "connected".
// ###########################################################################
//
// THE TWO CHECKS ARE DUALS AND BOTH ARE HERE
//
// "The callback requires both and that they match" is two obligations, and each has an
// implementation that satisfies the other while failing it:
//
//   * Comparing `cookieValue === stateParameter` AND NOTHING ELSE accepts a value an
//     attacker forged wholesale, because two copies of a forgery match each other
//     perfectly. The signature check is what kills that.
//   * Verifying the signature AND NOTHING ELSE accepts a valid state that never came
//     from THIS browser — which is the CSRF hole itself, since the `state` parameter
//     travels in a url an attacker composes while the httpOnly cookie does not. The
//     pair comparison is what kills that.
//
// Neither is the contract. Both are. `apps/web/__tests__/first-run/slack-oauth-state
// .test.ts` carries a row for each, and deleting either re-opens a class.
//
// THE CLOCK, THE NONCE AND THE SECRET ARE ALL INJECTED
//
// Not for purity as an aesthetic: a `Date.now()` inside this module would make the
// expiry-boundary rows a coin flip that passes on a fast machine, a `Math.random()`
// would make "two states in the same millisecond differ" unassertable, and reading
// `BETTER_AUTH_SECRET` at import would make "a state signed under another
// installation's secret is refused" unwritable. Each dep exists because a row that
// matters cannot be stated without it.
import { createHmac, timingSafeEqual } from "node:crypto";

import {
  parseSlackOAuthAccess,
  readSlackJsonBody,
  SLACK_OAUTH_ACCESS_URL,
  SLACK_REQUEST_TIMEOUT_MS,
} from "@growthmind/adapters";
import type { ServerEnv } from "@growthmind/shared";

// ===========================================================================
// AD-6 — is there a Slack app to send anybody to?
// ===========================================================================

/**
 * The Slack app's credentials, present TOGETHER or not at all.
 *
 * One alone cannot complete the round trip — an id with no secret reaches the consent
 * screen and dies at the exchange, which is the worst of the three states because the
 * founder has already left the product by then. `serverEnvSchema` deliberately declines
 * to encode "both or neither" (`packages/shared/src/env.ts`), naming this file as where
 * the pair is read together. This is that place.
 */
export interface SlackOAuthCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

/**
 * THE ONE PLACE THAT DECIDES WHETHER THE OAUTH PATH EXISTS.
 *
 * It returns the credentials rather than a boolean, and `slackOAuthConfigured` below is
 * defined as "this returned something". That is deliberate (D11): a boolean computed
 * here and credentials re-derived at the call site are two answers to one question, and
 * the day they disagree is the day a founder is redirected to a consent screen built
 * from an id that the availability flag said was absent.
 *
 * `env` is a PARAMETER, never `process.env` read inside. AD-6 puts this decision on the
 * server and passes the result down as a prop; a module that read the environment at
 * import could not be driven through the "only the id" and "only the secret" cases at
 * all, and those are exactly the two a half-finished setup produces.
 */
export function resolveSlackOAuthCredentials(env: ServerEnv): SlackOAuthCredentials | null {
  const { SLACK_CLIENT_ID: clientId, SLACK_CLIENT_SECRET: clientSecret } = env;

  // Both, or neither. `serverEnvSchema` already rejects an empty string for either
  // (`.min(1)`), so an absent value is the only shape that reaches here as "unset" —
  // which is why that `.min(1)` is not decorative.
  if (clientId === undefined || clientSecret === undefined) return null;

  return { clientId, clientSecret };
}

/**
 * AD-6's server-computed flag, and the single source the status payload reads.
 *
 * Never computed in a client component. `SLACK_CLIENT_ID` is a SERVER variable, so
 * `process.env.SLACK_CLIENT_ID` in the browser is `undefined` and the card would render
 * the "no Slack app" branch for every installation, INCLUDING the ones that configured
 * one. There is no `NEXT_PUBLIC_` twin and there must never be.
 */
export function slackOAuthConfigured(env: ServerEnv): boolean {
  return resolveSlackOAuthCredentials(env) !== null;
}

/** Slack's consent screen. A browser redirect target, not an API call. */
export const SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";

/** Where Slack sends the founder back. One constant, because the authorize request and
 *  the token exchange must send the BYTE-IDENTICAL `redirect_uri` or Slack refuses the
 *  exchange — two routes each building their own string is a wire waiting to be cut. */
export const SLACK_OAUTH_CALLBACK_PATH = "/api/first-run/slack/oauth/callback";

/**
 * The callback address, derived from configuration and from nothing else.
 *
 * A REDIRECT URI BUILT FROM A REQUEST HEADER IS AN OPEN REDIRECT. `Host` and
 * `X-Forwarded-Host` are both caller-controlled, so a request routed through an
 * attacker's hostname would tell Slack to deliver the authorization code there — and
 * that code seals a bot token into this organization. `BETTER_AUTH_URL` is
 * configuration, which a request cannot touch.
 */
export function slackOAuthRedirectUri(env: ServerEnv): string {
  return new URL(SLACK_OAUTH_CALLBACK_PATH, env.BETTER_AUTH_URL).href;
}

/**
 * The cookie the signed state is set in.
 *
 * Exported because the start route writes it and the callback route reads and clears
 * it, and a task identifier spelled twice is a task identifier spelled wrong once (D9).
 * A callback that read a name the start route never wrote would find no cookie on every
 * legitimate round trip — and "no cookie" is a refusal, so the symptom would be a
 * feature that never works rather than one that works insecurely.
 */
export const SLACK_OAUTH_STATE_COOKIE = "growthmind_slack_oauth_state";

/**
 * The cookie's ATTRIBUTES, beside its name for the same reason the name is
 * exported at all.
 *
 * `HttpOnly` — the cookie value IS the secret in this mechanism, so a script on
 * any page of this app being able to read it would hand an attacker the half of
 * the pair they cannot otherwise obtain. `SameSite=Lax` — a third-party page
 * must not be able to cause the round trip to be walked with the victim's cookie
 * attached, and `Lax` still sends it on the top-level navigation Slack performs,
 * which `Strict` would not. `Path=/` — the cookie is written by a route under
 * `/api` and read by another one, and a narrower path is a cookie the callback
 * never receives.
 */
const STATE_COOKIE_ATTRIBUTES = "Path=/; HttpOnly; SameSite=Lax";

/**
 * `Secure` is decided by CONFIGURATION, never by the request.
 *
 * The same argument `slackOAuthRedirectUri` makes: `X-Forwarded-Proto` is
 * caller-controlled, so a cookie whose `Secure` flag came from a header is one
 * an attacker can ask us to drop. A self-hosted installation on plain http still
 * has to work, which is why this is derived rather than hard-coded to `true`.
 */
function isSecurelyAddressed(env: ServerEnv): boolean {
  return new URL(env.BETTER_AUTH_URL).protocol === "https:";
}

/**
 * The `Set-Cookie` the start route writes.
 *
 * `Max-Age` is computed from the SAME `expiresAt` the MAC covers, so the cookie
 * and the value inside it die together. A cookie that outlives its state
 * produces `state_expired` on a round trip the browser still believes in, which
 * reads to a founder as the button being broken.
 */
export function slackOAuthStateCookie(state: SignedOAuthState, env: ServerEnv, now: Date): string {
  const maxAgeSeconds = Math.max(0, Math.ceil((state.expiresAt.getTime() - now.getTime()) / 1000));
  const parts = [
    `${SLACK_OAUTH_STATE_COOKIE}=${state.cookieValue}`,
    STATE_COOKIE_ATTRIBUTES,
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isSecurelyAddressed(env)) parts.push("Secure");
  return parts.join("; ");
}

/**
 * The `Set-Cookie` the callback writes on its way out, on EVERY exit.
 *
 * A state is single-use. Leaving it in the browser after the round trip has been
 * settled leaves a redeemable value sitting in a shared machine's cookie jar for
 * the rest of its ten minutes, and it is exactly as useful to an attacker after
 * a failure as after a success — a refusal we cleared nothing for is a refusal
 * that can simply be retried.
 */
export function clearedSlackOAuthStateCookie(env: ServerEnv): string {
  const parts = [`${SLACK_OAUTH_STATE_COOKIE}=`, STATE_COOKIE_ATTRIBUTES, "Max-Age=0"];
  if (isSecurelyAddressed(env)) parts.push("Secure");
  return parts.join("; ");
}

/**
 * The state cookie off a raw `Cookie` header, or `null`.
 *
 * `null` for absent AND for present-but-empty, because both are what a cleared
 * cookie looks like on the wire and `verifyOAuthState` treats both as
 * `state_missing` — absence is a refusal here, never a skipped check.
 */
export function slackOAuthStateCookieOf(header: string | null): string | null {
  if (header === null) return null;

  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() !== SLACK_OAUTH_STATE_COOKIE) continue;

    const value = pair.slice(separator + 1).trim();
    return value.length === 0 ? null : value;
  }

  return null;
}

// ===========================================================================
// AD-5 — the signed state
// ===========================================================================

/**
 * The two fields the state is bound to.
 *
 * BOTH, NOT EITHER. The user id alone would let a founder who belongs to two
 * organisations have a state signed while acting in one and redeemed while acting in
 * the other — a same-person, wrong-tenant write (D7), which is the quiet cousin of the
 * cross-attacker case in the header.
 */
export interface OAuthStateIdentity {
  readonly userId: string;
  readonly organizationId: string;
}

/** What the verifier needs from outside itself. `secret` is this installation's
 *  `BETTER_AUTH_SECRET`, passed rather than read; `now` is the repository's clock
 *  convention verbatim (`apps/web/lib/first-run/deps.ts`). */
export interface OAuthStateVerifierDeps {
  readonly secret: string;
  readonly now: () => Date;
}

/** The signer's deps: the verifier's, plus the source of the nonce. */
export interface OAuthStateSignerDeps extends OAuthStateVerifierDeps {
  readonly nonce: () => string;
}

/**
 * One signed state.
 *
 * `cookieValue` and `stateParameter` are THE SAME STRING — AD-5 says the value is "set
 * httpOnly/SameSite=Lax and echoed as `state`", and echoed means echoed. Two fields
 * rather than one because the callback reads them from two different places, and the
 * whole point of the mechanism is that those two places can disagree.
 *
 * `expiresAt` is returned rather than kept private so the caller can set the cookie's
 * `Max-Age` from the same instant the MAC covers. A cookie that outlives the value
 * inside it is a cookie that produces `state_expired` on a round trip the browser still
 * believes in.
 */
export interface SignedOAuthState {
  readonly cookieValue: string;
  readonly stateParameter: string;
  readonly expiresAt: Date;
}

/**
 * Why a refusal is a code and not a thrown error.
 *
 * A refusal reaches a log and a redirect. A callback that cannot say WHY it refused
 * leaves an operator unable to tell a founder who took too long over the consent screen
 * apart from somebody probing the endpoint — and those two need different responses.
 *
 * A UNION RATHER THAN A BARE `string`. The Wave 0 suite types the field `string`
 * because it declined to legislate a vocabulary on this file's behalf; it asserts only
 * that a slow founder and a forgery do not collapse into one code. Naming the six here
 * is strictly more than that contract asks and costs nothing: the union is assignable
 * to `string`, and it makes a typo at the consuming route a compile error rather than a
 * branch that silently never runs (D9).
 */
export type OAuthStateRefusalCode =
  /** One or both halves never arrived. A hand-composed callback url, a dropped cookie,
   *  or a request that never went through `oauth/start` at all. */
  | "state_missing"
  /** Both arrived and they are different values. Two individually valid states crossed
   *  — the shape an attacker's link produces when they can write the url but not the
   *  victim's httpOnly cookie. */
  | "state_mismatch"
  /** Not a signed state at all: a truncated redirect, a link a mail client rewrote,
   *  something typed into the address bar. */
  | "state_malformed"
  /** Structurally a state, but not one THIS installation signed. A forgery, or a state
   *  from another deployment. */
  | "state_signature_invalid"
  /** Genuinely ours, genuinely for this session, and too old. The slow-founder code,
   *  and the one that must never be confused with the three above. */
  | "state_expired"
  /** Ours, current, and signed for somebody else — another organisation, or a teammate.
   *  The tenant boundary, refused (D7). */
  | "state_identity_mismatch";

export type VerifyOAuthStateResult =
  { readonly ok: true } | { readonly ok: false; readonly code: OAuthStateRefusalCode };

/** What the callback presents. Both halves are `string | null` because both are
 *  genuinely absent in production, and absence is a refusal rather than a skipped
 *  check. `expected` is the identity of the SESSION THAT IS CALLING, and it is
 *  REQUIRED: a verifier that could be called without an organisation could be called
 *  with the wrong one. */
export interface VerifyOAuthStateInput {
  readonly cookieValue: string | null;
  readonly stateParameter: string | null;
  readonly expected: OAuthStateIdentity;
}

/**
 * TEN MINUTES.
 *
 * The Wave 0 suite pins a RANGE — at least two minutes, at most fifteen — and leaves
 * the number here, because both ends have an argument and the middle does not.
 *
 * Too short and a founder who has to sign into Slack first, pick between three
 * workspaces, and read what they are approving is refused for being careful; that
 * person then repeats the whole round trip with no idea what they did wrong. Ten
 * minutes covers a genuine read of the consent screen plus a Slack login, with room for
 * an interruption.
 *
 * Too long and a state lifted from a browser's history, a shared screen, or a proxy log
 * stays redeemable for the rest of the working day. Ten minutes bounds that to roughly
 * the window in which the founder is still sitting in front of the same screen.
 */
export const OAUTH_STATE_LIFETIME_MS = 10 * 60_000;

/** The signed payload, as it travels. Short keys because this string ends up in a url
 *  and a cookie; the shape is pinned by `oauthStatePayloadOf` below and by nothing
 *  else, so the abbreviations cannot drift into a consumer. */
interface OAuthStatePayload {
  /** Format version. Inside the MAC, so a future format cannot be forced onto this
   *  reader by editing the value. */
  readonly v: 1;
  readonly u: string;
  readonly o: string;
  /** The nonce. Without it there is one state per founder per clock tick, replayable by
   *  anybody who saw the url once. */
  readonly n: string;
  /** `expiresAt` as epoch milliseconds. */
  readonly x: number;
}

const STATE_SEPARATOR = ".";

const encodePart = (value: string): string => Buffer.from(value, "utf8").toString("base64url");

/**
 * The MAC, computed over THE ENCODED PAYLOAD STRING rather than over the decoded
 * object.
 *
 * That ordering is the whole reason this file cannot be tricked into parsing hostile
 * input: the bytes are authenticated first, and only bytes we signed are ever handed to
 * `JSON.parse`. Verifying a re-encoding of the decoded object instead would make the
 * signature depend on key order and on whatever the parser was willing to accept.
 */
function signPart(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

/**
 * Constant-time string comparison.
 *
 * Used for the signature AND for the cookie/parameter pair. The pair comparison is the
 * less obvious of the two: the cookie value IS the secret in this mechanism — an
 * attacker who learns it wins outright — so comparing it with `===` would leak its
 * prefix through timing to anyone able to submit guesses. The cost of not caring is
 * unbounded; the cost of caring is this function.
 */
function constantTimeEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");

  // `timingSafeEqual` throws on a length mismatch, so the lengths are compared first.
  // The length of a state is not a secret: it is fixed by the format.
  if (leftBytes.length !== rightBytes.length) return false;

  return timingSafeEqual(leftBytes, rightBytes);
}

/** Reads a payload that has ALREADY been authenticated. `null` for anything that is not
 *  the shape this file writes — reachable only through a bug on our side or a secret
 *  compromise, and still refused rather than trusted. */
function oauthStatePayloadOf(encodedPayload: string): OAuthStatePayload | null {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));

    if (typeof decoded !== "object" || decoded === null) return null;

    const { v, u, o, n, x } = decoded as Record<keyof OAuthStatePayload, unknown>;

    if (v !== 1) return null;
    if (typeof u !== "string" || u.length === 0) return null;
    if (typeof o !== "string" || o.length === 0) return null;
    if (typeof n !== "string" || n.length === 0) return null;
    if (typeof x !== "number" || !Number.isFinite(x)) return null;

    return { v: 1, u, o, n, x };
  } catch {
    return null;
  }
}

const refuse = (code: OAuthStateRefusalCode): VerifyOAuthStateResult => ({ ok: false, code });

/**
 * Signs one state for one founder acting in one organisation.
 *
 * The returned pair is two names for one string. The caller sets `cookieValue` as an
 * httpOnly, SameSite=Lax cookie and puts `stateParameter` on the authorize url; the
 * callback then has one value that arrived two ways, and can tell whether both journeys
 * really happened.
 */
export function signOAuthState(
  input: { readonly identity: OAuthStateIdentity },
  deps: OAuthStateSignerDeps,
): SignedOAuthState {
  const expiresAt = new Date(deps.now().getTime() + OAUTH_STATE_LIFETIME_MS);

  const payload: OAuthStatePayload = {
    v: 1,
    u: input.identity.userId,
    o: input.identity.organizationId,
    n: deps.nonce(),
    x: expiresAt.getTime(),
  };

  const encodedPayload = encodePart(JSON.stringify(payload));
  const value = `${encodedPayload}${STATE_SEPARATOR}${signPart(encodedPayload, deps.secret)}`;

  return { cookieValue: value, stateParameter: value, expiresAt };
}

/**
 * Verifies what the callback was handed. NEVER THROWS — every exit is a result.
 *
 * A verifier that threw on undecodable input would turn a refusal into a 500, and a 500
 * is where retry logic and error pages start making decisions nobody designed (D5/D8).
 * The inputs that reach here include a truncated redirect, a link a mail client
 * rewrote, and somebody typing in the address bar.
 *
 * THE ORDER OF THE CHECKS IS PART OF THE CONTRACT:
 *
 *   1. presence, 2. the pair matches, 3. the shape is readable, 4. WE signed it,
 *   5. it is still alive, 6. it is for the caller.
 *
 * The signature comes before the expiry deliberately. `expiresAt` travels inside the
 * state, so reading it before the MAC has been checked would be trusting an attacker's
 * number to decide whether an attacker's state had expired.
 */
export function verifyOAuthState(
  input: VerifyOAuthStateInput,
  deps: OAuthStateVerifierDeps,
): VerifyOAuthStateResult {
  const { cookieValue, stateParameter, expected } = input;

  // ABSENCE IS A REFUSAL, NOT A SKIPPED CHECK. `if (cookie && cookie !== parameter)
  // refuse` reads as a careful comparison and lets every request with no cookie
  // straight through — which is precisely the request an attacker's link produces,
  // because they cannot write an httpOnly cookie into the victim's browser. The empty
  // string is here too: that is what a cleared cookie looks like on the wire.
  if (cookieValue === null || cookieValue.length === 0) return refuse("state_missing");
  if (stateParameter === null || stateParameter.length === 0) return refuse("state_missing");

  // Half of "the callback requires BOTH and that they match". Kills the
  // valid-signature-from-another-browser case.
  if (!constantTimeEquals(cookieValue, stateParameter)) return refuse("state_mismatch");

  // EXACTLY two parts. `"a.b.c.d.e"` and `"...."` are both things that arrive at a
  // callback, and a reader that took the first two segments of either would be
  // authenticating a prefix of something it does not understand.
  const parts = cookieValue.split(STATE_SEPARATOR);
  if (parts.length !== 2) return refuse("state_malformed");

  const encodedPayload = parts[0];
  const signature = parts[1];
  if (encodedPayload.length === 0 || signature.length === 0) return refuse("state_malformed");

  // The other half. Kills the wholesale forgery that matches itself.
  if (!constantTimeEquals(signature, signPart(encodedPayload, deps.secret))) {
    return refuse("state_signature_invalid");
  }

  const payload = oauthStatePayloadOf(encodedPayload);
  if (payload === null) return refuse("state_malformed");

  // `>=`, not `>`: the state is dead AT its expiry instant, not one millisecond after.
  // Stated from both sides by two rows in the suite, so neither an off-by-one that
  // expires everything nor one that expires nothing can pass.
  if (deps.now().getTime() >= payload.x) return refuse("state_expired");

  // THE SECURITY POINT OF THE WHOLE MECHANISM. Both fields, one comparison each: a
  // check that read only the user id would accept the same person's state redeemed in
  // the wrong organisation, and the organisation is the field the attack turns on.
  if (payload.u !== expected.userId || payload.o !== expected.organizationId) {
    return refuse("state_identity_mismatch");
  }

  return { ok: true };
}

// ===========================================================================
// The token exchange
// ===========================================================================

/**
 * What the exchange needs. `fetch` is INJECTED (AD-8) rather than reached for globally:
 * without that, "a mismatched state costs zero outbound calls" is unprovable, and a
 * test that cannot fail is not a test.
 */
export interface SlackCodeExchangeDeps {
  readonly fetch: typeof globalThis.fetch;
  readonly clientId: string;
  readonly clientSecret: string;
  /** Byte-identical to the one the authorize request carried, or Slack refuses. Build
   *  it with `slackOAuthRedirectUri` at both ends and it cannot differ. */
  readonly redirectUri: string;
}

/**
 * Why a refused exchange is TERMINAL and a failed call is not.
 *
 * An authorization code is single-use and short-lived, so every retry of a refused
 * exchange is refused identically — `invalid_code`, `bad_redirect_uri`,
 * `invalid_client_id` all mean "this round trip is over". The founder's next action is
 * to press "Add to Slack" again, which mints a new code; a lane that retried the old
 * one would burn its budget while the founder watched a spinner.
 *
 * `call_failed` is the other direction: a transport fault, a timeout, or a body we
 * could not read says nothing about the code, so trying again is exactly right.
 *
 * UNCLASSIFIED SLACK ERRORS LAND ON `exchange_refused`, and that is the deliberate
 * fail-direction (D10). `../../../packages/adapters/src/slack/errors.ts` defaults an
 * unknown POST error to the RETRYABLE arm, and the reasoning inverts here: there, a
 * wrong guess strands a finding a retry would have delivered; here, a wrong guess makes
 * a founder wait through retries of a code that can never be redeemed, when the one
 * thing that works — start again — is a single button press away.
 */
export type SlackCodeExchangeRefusalCode = "exchange_refused" | "call_failed";

/**
 * A completed install. `teamName` is `string | undefined` because Slack's `team.name`
 * is a display label rather than a load-bearing field, and refusing an otherwise valid
 * grant over a missing label would trade the credential for the caption.
 */
export type ExchangeCodeResult =
  | {
      readonly ok: true;
      readonly botToken: string;
      readonly teamId: string;
      readonly teamName: string | undefined;
    }
  | { readonly ok: false; readonly code: SlackCodeExchangeRefusalCode };

/**
 * Redeems Slack's authorization code for a bot token. NEVER THROWS.
 *
 * ###########################################################################
 * # THE BOT TOKEN APPEARS IN EXACTLY ONE PLACE: THE SUCCESS ARM'S `botToken`
 * # FIELD. It is in no returned refusal, no log line, and no thrown value.
 * #
 * # That is a property of this function's SHAPE, not of a reviewer having
 * # checked every branch: the failure arm carries a two-member union and
 * # nothing else, so there is no expression here through which a token, a
 * # response body, or a client secret could reach a caller that did not
 * # succeed. The same argument `slack/errors.ts` makes about `postFailure`.
 * ###########################################################################
 */
export async function exchangeCode(
  code: string,
  deps: SlackCodeExchangeDeps,
): Promise<ExchangeCodeResult> {
  // The outer guard. Given the inner ones it is unreachable today, and it stays so
  // "never throws" is a property of the function rather than of the current branch set,
  // including the branches a later edit adds.
  try {
    // Form-encoded, which is what `oauth.v2.access` documents. The client secret travels
    // in the body rather than the query string so it cannot land in an access log.
    const body = new URLSearchParams({
      code,
      client_id: deps.clientId,
      client_secret: deps.clientSecret,
      redirect_uri: deps.redirectUri,
    });

    let response: Response;
    try {
      response = await deps.fetch(SLACK_OAUTH_ACCESS_URL, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded; charset=utf-8",
          accept: "application/json",
        },
        body: body.toString(),
        // A redirect goes wherever the upstream points. Treat one as a response to be
        // read, never as a hop to follow — this request carries the client secret.
        redirect: "manual",
        // Without this, a host that accepts the connection and never answers holds the
        // callback open for as long as the runtime allows, and the founder watches a
        // browser spinner with no ending.
        signal: AbortSignal.timeout(SLACK_REQUEST_TIMEOUT_MS),
      });
    } catch {
      return { ok: false, code: "call_failed" };
    }

    // HTTP 200 IS NOT SUCCESS HERE. Slack answers this method with 200 and
    // `{"ok":false,"error":"invalid_code"}`; the status says the call was served, the
    // body says no token was issued.
    const envelope = parseSlackOAuthAccess(await readSlackJsonBody(response));

    // `null` is "we could not read this at all" — an html error page from a proxy, an
    // empty body, a success claim with no token in it. Not knowing is not a refusal by
    // Slack, so it takes the retryable arm.
    if (envelope === null) return { ok: false, code: "call_failed" };
    if (!envelope.ok) return { ok: false, code: "exchange_refused" };

    // A 2xx and an `ok: true` must agree before anything is stored. `ok: true` on a
    // non-2xx has never been observed and costs one branch to rule out.
    if (!response.ok) return { ok: false, code: "call_failed" };

    return {
      ok: true,
      botToken: envelope.value.accessToken,
      teamId: envelope.value.teamId,
      teamName: envelope.value.teamName,
    };
  } catch {
    return { ok: false, code: "call_failed" };
  }
}
