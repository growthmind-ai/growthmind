// THE STATE COOKIE'S ATTRIBUTES — and specifically where `Secure` comes from.
//
// ###########################################################################
// # THIS FILE EXISTS BECAUSE THE REPOSITORY HAS NOW MADE THE SAME ARGUMENT
// # TWICE.
// #
// # `apps/web/lib/auth.ts` pins Better Auth's `useSecureCookies` to
// # `process.env.NODE_ENV` rather than letting it be derived from `baseURL`,
// # and states why in a comment: the shipped compose profile's
// # `BETTER_AUTH_URL` is `http://localhost:3000`, so a self-hoster who
// # terminates TLS at a proxy and never overrides it would be handed session
// # cookies with no `Secure` flag. `isSecurelyAddressed` in
// # `apps/web/lib/slack/oauth.ts` was later written as exactly that derivation
// # — `new URL(env.BETTER_AUTH_URL).protocol === "https:"` — re-introducing the
// # pattern the comment exists to prevent.
// #
// # It is worse on this cookie than on the session one. `cookieValue` and
// # `stateParameter` are THE SAME STRING, so a state cookie recovered off the
// # wire defeats BOTH halves of the callback's dual check at once: the attacker
// # puts the stolen value in a callback url beside their own `code`,
// # `SameSite=Lax` sends the cookie on the victim's top-level navigation, the
// # pair matches, the signature verifies, and the identity matches because the
// # state was minted FOR the victim. The attacker's Slack workspace becomes the
// # victim organisation's delivery channel, silently.
// #
// # The rows below fix the flag to the RUNTIME, not to a url, so a third
// # attempt at the derivation fails here instead of in production.
// ###########################################################################
//
// ── WHY `BETTER_AUTH_URL` IS MOVED AND NOT MERELY LEFT ALONE ────────────────
//
// Two of the rows set `BETTER_AUTH_URL` to an http address while `NODE_ENV` is
// `production`, and to an https one while it is not. That crossing is the whole
// point: a derivation from the url passes a test that only ever varies
// `NODE_ENV`, and a hard-coded `true` passes a test that only ever varies the
// url. Varying them against each other is what pins the flag to the runtime.
import { afterEach, describe, expect, test } from "bun:test";

import {
  clearedSlackOAuthStateCookie,
  SLACK_OAUTH_STATE_COOKIE,
  slackOAuthStateCookie,
  type SignedOAuthState,
} from "../../lib/slack/oauth";

const NOW = new Date("2026-08-01T10:00:00.000Z");

/** A signed state's shape, without signing one — these two helpers read
 *  `cookieValue` and `expiresAt` and nothing else, so a real MAC here would be
 *  ceremony that makes the rows harder to read rather than stronger. */
const STATE: SignedOAuthState = {
  cookieValue: "fixture-state-value",
  stateParameter: "fixture-state-value",
  expiresAt: new Date(NOW.getTime() + 10 * 60_000),
};

/** `process.env` is process-wide, so every row that moves it puts it back —
 *  including on a throw, or the next suite in the same process inherits it. */
const priorEnv = new Map<string, string | undefined>();

function setEnv(patch: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(patch)) {
    if (!priorEnv.has(name)) priorEnv.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

afterEach(() => {
  for (const [name, value] of priorEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  priorEnv.clear();
});

describe("the Slack OAuth state cookie", () => {
  test("carries Secure in production even when BETTER_AUTH_URL is a plain http address", () => {
    // The self-hoster who terminates TLS at a proxy and never overrode the
    // variable. `auth.ts:44-49` names this exact person.
    setEnv({ NODE_ENV: "production", BETTER_AUTH_URL: "http://localhost:3000" });

    expect(slackOAuthStateCookie(STATE, NOW)).toContain("Secure");
    expect(clearedSlackOAuthStateCookie()).toContain("Secure");
  });

  test("omits Secure outside production even when BETTER_AUTH_URL is https", () => {
    // The mirror. A flag hard-coded to `true` would pass the row above and fail
    // here, and a local https tunnel is a normal way to develop the Slack round
    // trip (.env.example's Slack section documents it).
    setEnv({ NODE_ENV: "development", BETTER_AUTH_URL: "https://tunnel.example.com" });

    expect(slackOAuthStateCookie(STATE, NOW)).not.toContain("Secure");
    expect(clearedSlackOAuthStateCookie()).not.toContain("Secure");
  });

  test("the write and the clear agree on every attribute except the value and the age", () => {
    setEnv({ NODE_ENV: "production", BETTER_AUTH_URL: "http://localhost:3000" });

    // A cleared cookie a browser will not overwrite is a state left redeemable
    // for the rest of its ten minutes: `Set-Cookie` matches on name/path/domain
    // and on the `Secure` flag, so the two strings drifting apart is a clear
    // that silently does nothing.
    for (const attribute of ["Path=/", "HttpOnly", "SameSite=Lax", "Secure"]) {
      expect({ attribute, written: slackOAuthStateCookie(STATE, NOW).includes(attribute) }).toEqual(
        {
          attribute,
          written: true,
        },
      );
      expect({ attribute, cleared: clearedSlackOAuthStateCookie().includes(attribute) }).toEqual({
        attribute,
        cleared: true,
      });
    }

    expect(clearedSlackOAuthStateCookie()).toContain(`${SLACK_OAUTH_STATE_COOKIE}=;`);
    expect(clearedSlackOAuthStateCookie()).toContain("Max-Age=0");
  });
});
