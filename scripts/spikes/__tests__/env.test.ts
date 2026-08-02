import { describe, expect, test } from "bun:test";

import { ENV_VARS, REQUIRED_ENV_VARS } from "../lib/constants";
import { formatCredentialError, validateCredentials } from "../lib/env";

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

    for (const name of REQUIRED_ENV_VARS) {
      expect(message).toContain(name);
    }

    expect(message).toContain(".env");

    expect(message.toLowerCase()).toContain("project settings");
    expect(message).toContain("phc_");

    expect(message.toLowerCase()).toContain("personal api key");
    expect(message).toContain("phx_");

    expect(message).not.toMatch(/^\s*at /m);
  });
});
