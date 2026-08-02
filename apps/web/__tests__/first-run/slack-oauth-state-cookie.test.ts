// NODE_ENV is crossed against BETTER_AUTH_URL both ways: neither url derivation nor hard-coded true passes.
import { afterEach, describe, expect, test } from "bun:test";

import {
  clearedSlackOAuthStateCookie,
  SLACK_OAUTH_STATE_COOKIE,
  slackOAuthStateCookie,
  type SignedOAuthState,
} from "../../lib/slack/oauth";

const NOW = new Date("2026-08-01T10:00:00.000Z");

const STATE: SignedOAuthState = {
  cookieValue: "fixture-state-value",
  stateParameter: "fixture-state-value",
  expiresAt: new Date(NOW.getTime() + 10 * 60_000),
};

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
    setEnv({ NODE_ENV: "production", BETTER_AUTH_URL: "http://localhost:3000" });

    expect(slackOAuthStateCookie(STATE, NOW)).toContain("Secure");
    expect(clearedSlackOAuthStateCookie()).toContain("Secure");
  });

  test("omits Secure outside production even when BETTER_AUTH_URL is https", () => {
    setEnv({ NODE_ENV: "development", BETTER_AUTH_URL: "https://tunnel.example.com" });

    expect(slackOAuthStateCookie(STATE, NOW)).not.toContain("Secure");
    expect(clearedSlackOAuthStateCookie()).not.toContain("Secure");
  });

  test("the write and the clear agree on every attribute except the value and the age", () => {
    setEnv({ NODE_ENV: "production", BETTER_AUTH_URL: "http://localhost:3000" });

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
