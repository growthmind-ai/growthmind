import { createHmac } from "node:crypto";

import {
  parseSlackOAuthAccess,
  readSlackJsonBody,
  SLACK_OAUTH_ACCESS_URL,
  SLACK_REQUEST_TIMEOUT_MS,
} from "@growthmind/adapters";
import type { WebEnv } from "@growthmind/shared";

import { constantTimeEquals } from "./constant-time";

export interface SlackOAuthCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

export function resolveSlackOAuthCredentials(env: WebEnv): SlackOAuthCredentials | null {
  const { SLACK_CLIENT_ID: clientId, SLACK_CLIENT_SECRET: clientSecret } = env;

  if (clientId === undefined || clientSecret === undefined) return null;

  return { clientId, clientSecret };
}

export function slackOAuthConfigured(env: WebEnv): boolean {
  return resolveSlackOAuthCredentials(env) !== null;
}

export const SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";

export const SLACK_OAUTH_CALLBACK_PATH = "/api/first-run/slack/oauth/callback";

// Derived from configuration, never from a request header: `Host` and `X-Forwarded-Host`
// are caller-controlled, so a header-built redirect uri is an open redirect for the code.
export function slackOAuthRedirectUri(env: WebEnv): string {
  return new URL(SLACK_OAUTH_CALLBACK_PATH, env.BETTER_AUTH_URL).href;
}

export const SLACK_OAUTH_STATE_COOKIE = "growthmind_slack_oauth_state";

const STATE_COOKIE_ATTRIBUTES = "Path=/; HttpOnly; SameSite=Lax";

// `Secure` is pinned to `NODE_ENV` and deliberately NOT derived from `BETTER_AUTH_URL`:
// behind a proxy terminating TLS that url is http, so deriving it yields a cookie with no
// `Secure` flag — and since `cookieValue` and `stateParameter` are the same string, one
// stolen cookie defeats both halves of the callback's check at once.
function isSecurelyAddressed(): boolean {
  return process.env.NODE_ENV === "production";
}

export function slackOAuthStateCookie(state: SignedOAuthState, now: Date): string {
  const maxAgeSeconds = Math.max(0, Math.ceil((state.expiresAt.getTime() - now.getTime()) / 1000));
  const parts = [
    `${SLACK_OAUTH_STATE_COOKIE}=${state.cookieValue}`,
    STATE_COOKIE_ATTRIBUTES,
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isSecurelyAddressed()) parts.push("Secure");
  return parts.join("; ");
}

export function clearedSlackOAuthStateCookie(): string {
  const parts = [`${SLACK_OAUTH_STATE_COOKIE}=`, STATE_COOKIE_ATTRIBUTES, "Max-Age=0"];
  if (isSecurelyAddressed()) parts.push("Secure");
  return parts.join("; ");
}

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

export interface OAuthStateIdentity {
  readonly userId: string;
  readonly organizationId: string;
}

export interface OAuthStateVerifierDeps {
  readonly secret: string;
  readonly now: () => Date;
}

export interface OAuthStateSignerDeps extends OAuthStateVerifierDeps {
  readonly nonce: () => string;
}

export interface SignedOAuthState {
  readonly cookieValue: string;
  readonly stateParameter: string;
  readonly expiresAt: Date;
}

export type OAuthStateRefusalCode =
  | "state_missing"
  | "state_mismatch"
  | "state_malformed"
  | "state_signature_invalid"
  | "state_expired"
  | "state_identity_mismatch";

export type VerifyOAuthStateResult =
  { readonly ok: true } | { readonly ok: false; readonly code: OAuthStateRefusalCode };

export interface VerifyOAuthStateInput {
  readonly cookieValue: string | null;
  readonly stateParameter: string | null;
  // Required, never optional: a verifier callable without an organisation is one callable
  // with the wrong one.
  readonly expected: OAuthStateIdentity;
}

export const OAUTH_STATE_LIFETIME_MS = 10 * 60_000;

interface OAuthStatePayload {
  readonly v: 1;
  readonly u: string;
  readonly o: string;
  readonly n: string;
  readonly x: number;
}

const STATE_SEPARATOR = ".";

const encodePart = (value: string): string => Buffer.from(value, "utf8").toString("base64url");

// A domain-separation label inside the MAC, because `BETTER_AUTH_SECRET` also signs Better
// Auth's session cookies: unlabelled, a signature minted by either mechanism is one the
// other accepts.
const STATE_MAC_DOMAIN = "growthmind.slack-oauth-state.v1";

// The MAC covers the ENCODED PAYLOAD STRING, never the decoded object, so only bytes we
// signed are ever handed to `JSON.parse`. Verifying a re-encoding of the parsed object
// would make the signature depend on key order — a forgery surface, not a style choice.
function signPart(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(STATE_MAC_DOMAIN)
    .update(encodedPayload)
    .digest("base64url");
}

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

export function verifyOAuthState(
  input: VerifyOAuthStateInput,
  deps: OAuthStateVerifierDeps,
): VerifyOAuthStateResult {
  const { cookieValue, stateParameter, expected } = input;

  if (cookieValue === null || cookieValue.length === 0) return refuse("state_missing");
  if (stateParameter === null || stateParameter.length === 0) return refuse("state_missing");

  // A dual check, and both halves are load-bearing: comparing the pair alone accepts a
  // wholesale forgery (two copies of a forgery match each other), and verifying the
  // signature alone accepts a state that never came from this browser — the CSRF hole.
  if (!constantTimeEquals(cookieValue, stateParameter)) return refuse("state_mismatch");

  const parts = cookieValue.split(STATE_SEPARATOR);
  if (parts.length !== 2) return refuse("state_malformed");

  const encodedPayload = parts[0];
  const signature = parts[1];
  if (encodedPayload.length === 0 || signature.length === 0) return refuse("state_malformed");

  if (!constantTimeEquals(signature, signPart(encodedPayload, deps.secret))) {
    return refuse("state_signature_invalid");
  }

  const payload = oauthStatePayloadOf(encodedPayload);
  if (payload === null) return refuse("state_malformed");

  // Deliberately AFTER the signature check, never hoisted above it as a cheaper test first:
  // `payload.x` travels inside the state, so an expiry read before the MAC has been
  // verified is trusting a number the attacker chose.
  if (deps.now().getTime() >= payload.x) return refuse("state_expired");

  if (payload.u !== expected.userId || payload.o !== expected.organizationId) {
    return refuse("state_identity_mismatch");
  }

  return { ok: true };
}

export interface SlackCodeExchangeDeps {
  readonly fetch: typeof globalThis.fetch;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export type SlackCodeExchangeRefusalCode = "exchange_refused" | "call_failed";

export type ExchangeCodeResult =
  | {
      readonly ok: true;
      readonly botToken: string;
      readonly teamId: string;
      readonly teamName: string | undefined;
    }
  | { readonly ok: false; readonly code: SlackCodeExchangeRefusalCode };

export async function exchangeCode(
  code: string,
  deps: SlackCodeExchangeDeps,
): Promise<ExchangeCodeResult> {
  try {
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
        redirect: "manual",
        signal: AbortSignal.timeout(SLACK_REQUEST_TIMEOUT_MS),
      });
    } catch {
      return { ok: false, code: "call_failed" };
    }

    // HTTP 200 is not success: Slack answers `oauth.v2.access` with 200 and
    // `{"ok":false,"error":"invalid_code"}` — the status says the call was served, the body
    // says no token was issued.
    const envelope = parseSlackOAuthAccess(await readSlackJsonBody(response));

    if (envelope === null) return { ok: false, code: "call_failed" };
    if (!envelope.ok) return { ok: false, code: "exchange_refused" };

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
