// Wave 0/1 RED tests for the credential gate (ADD D-8).
// Asserts the PUBLIC contract of scripts/spikes/lib/env.ts only:
// validateCredentials(env) and formatCredentialError(missing).
// Stubs throw "not implemented" — these tests MUST fail until Wave 2.

import { describe, expect, test } from "bun:test";

import { ENV_VARS, REQUIRED_ENV_VARS } from "../lib/constants";
import { formatCredentialError, validateCredentials } from "../lib/env";

/** All four required vars set to dummy (never real-looking) values. */
function fullEnv(): Record<string, string | undefined> {
  return {
    [ENV_VARS.POSTHOG_HOST]: "https://posthog.example.test",
    [ENV_VARS.POSTHOG_PROJECT_API_KEY]: "phc_test_dummy",
    [ENV_VARS.POSTHOG_PERSONAL_API_KEY]: "phx_test_dummy",
    [ENV_VARS.POSTHOG_PROJECT_ID]: "test-project-id",
  };
}

describe("validateCredentials", () => {
  test("should report all four variables missing when env is empty", () => {
    const result = validateCredentials({});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok: false");
    // Exactly the four names, in REQUIRED_ENV_VARS order.
    expect(result.missing).toEqual([...REQUIRED_ENV_VARS]);
  });

  test("should report only the one missing variable when three are set", () => {
    for (const missingVar of REQUIRED_ENV_VARS) {
      const env = fullEnv();
      delete env[missingVar];

      const result = validateCredentials(env);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error(`expected ok: false when ${missingVar} is absent`);
      expect(result.missing).toEqual([missingVar]);
    }
  });

  test("should treat empty-string values as missing", () => {
    const env = fullEnv();
    env[ENV_VARS.POSTHOG_PERSONAL_API_KEY] = "";

    const result = validateCredentials(env);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok: false for empty-string value");
    expect(result.missing).toEqual([ENV_VARS.POSTHOG_PERSONAL_API_KEY]);
  });

  test("should pass and return typed creds when all four are set", () => {
    const env = fullEnv();

    const result = validateCredentials(env);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok: true");
    expect(result.creds.host).toBe(env[ENV_VARS.POSTHOG_HOST] as string);
    expect(result.creds.projectApiKey).toBe(env[ENV_VARS.POSTHOG_PROJECT_API_KEY] as string);
    expect(result.creds.personalApiKey).toBe(env[ENV_VARS.POSTHOG_PERSONAL_API_KEY] as string);
    expect(result.creds.projectId).toBe(env[ENV_VARS.POSTHOG_PROJECT_ID] as string);
  });
});

describe("formatCredentialError", () => {
  test("should name each missing variable and where to obtain it in the formatted error", () => {
    const message = formatCredentialError([...REQUIRED_ENV_VARS]);

    // Every missing variable is named.
    for (const name of REQUIRED_ENV_VARS) {
      expect(message).toContain(name);
    }

    // Tells the user the values belong in .env.
    expect(message).toContain(".env");

    // Points at PostHog project settings (phc_ project key + project ID)...
    expect(message.toLowerCase()).toContain("project settings");
    expect(message).toContain("phc_");
    // ...and the personal API keys page (phx_ key).
    expect(message.toLowerCase()).toContain("personal api key");
    expect(message).toContain("phx_");

    // Plain-English block: no stack-trace content (no "at ..." frames).
    expect(message).not.toMatch(/^\s*at /m);
  });
});
