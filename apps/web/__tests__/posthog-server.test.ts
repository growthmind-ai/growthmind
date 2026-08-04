import { afterEach, describe, expect, test } from "bun:test";

import { getPostHogClient, isAnalyticsSuppressed } from "../lib/posthog-server";

const TOKEN_KEY = "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN";

const originalToken = process.env[TOKEN_KEY];

afterEach(() => {
  if (originalToken === undefined) {
    delete process.env[TOKEN_KEY];
    return;
  }
  process.env[TOKEN_KEY] = originalToken;
});

describe("analytics never leave a test run", () => {
  // The control: without it this whole suite passes on a machine that simply has no
  // token, proving nothing about the guard. Here the token IS set and the answer is
  // still null, so the suppression is what produced it.
  test("answers no client under test even when a token is configured", () => {
    process.env[TOKEN_KEY] = "phc_a_real_looking_token_for_this_test";

    expect(process.env.NODE_ENV).toBe("test");
    expect(getPostHogClient()).toBeNull();
  });

  test("suppresses on the environment the runner sets, and on nothing else", () => {
    expect(isAnalyticsSuppressed("test")).toBe(true);

    for (const env of ["production", "development", undefined, "", "testing", "TEST"]) {
      expect({ env, suppressed: isAnalyticsSuppressed(env) }).toEqual({ env, suppressed: false });
    }
  });
});
