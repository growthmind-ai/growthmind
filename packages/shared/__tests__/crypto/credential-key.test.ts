import { describe, expect, test } from "bun:test";

import { resolveCredentialKey } from "../../src/crypto/credential-key";
import { CREDENTIAL_KEY_BYTE_LENGTH } from "../../src/crypto/secret-box";
import { DEV_ENCRYPTION_KEY, parseServerEnv } from "../../src/env";

const PROD_BASE = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://s0-app:s0-placeholder@db.example.invalid:5432/growthmind",
  BETTER_AUTH_SECRET: "s0-fixture-auth-secret-not-a-real-one",
  BETTER_AUTH_URL: "https://s0-app.example.invalid",
} as const;

describe("resolveCredentialKey", () => {
  test("refuses the published dev default in production even when GROWTHMIND_ALLOW_INSECURE_DEFAULTS is set", () => {
    const env = parseServerEnv({
      ...PROD_BASE,
      GROWTHMIND_ENCRYPTION_KEY: DEV_ENCRYPTION_KEY,
      GROWTHMIND_ALLOW_INSECURE_DEFAULTS: "1",
    });
    expect(env.GROWTHMIND_ENCRYPTION_KEY).toBe(DEV_ENCRYPTION_KEY);
    expect(env.NODE_ENV).toBe("production");

    const result = resolveCredentialKey(env);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal, got a usable key");
    expect(result.reason).toBe("insecure_default_key");
  });

  test("accepts the dev default outside production", () => {
    const env = parseServerEnv({ NODE_ENV: "development" });
    expect(env.GROWTHMIND_ENCRYPTION_KEY).toBe(DEV_ENCRYPTION_KEY);

    const result = resolveCredentialKey(env);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`expected a usable key, got ${result.reason}`);
    expect(result.key.bytes).toHaveLength(CREDENTIAL_KEY_BYTE_LENGTH);
  });

  test("accepts a real production key", () => {
    const env = parseServerEnv({
      ...PROD_BASE,

      GROWTHMIND_ENCRYPTION_KEY: "czAtZml4dHVyZS1lbmNyeXB0aW9uLWtleS0zMmJ5dGVzIQ==",
    });

    const result = resolveCredentialKey(env);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`expected a usable key, got ${result.reason}`);
    expect(result.key.bytes).toHaveLength(CREDENTIAL_KEY_BYTE_LENGTH);
  });

  test("refuses a value that decodes to the published dev key bytes plus a suffix", () => {
    const devBytes = Buffer.from(DEV_ENCRYPTION_KEY, "base64");
    expect(devBytes).toHaveLength(CREDENTIAL_KEY_BYTE_LENGTH);

    const overLength = Buffer.concat([devBytes, Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])]).toString(
      "base64",
    );

    const env = parseServerEnv({
      ...PROD_BASE,
      GROWTHMIND_ENCRYPTION_KEY: overLength,
    });
    expect(env.GROWTHMIND_ENCRYPTION_KEY).not.toBe(DEV_ENCRYPTION_KEY);

    const result = resolveCredentialKey(env);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal, got a usable key");
    expect(result.reason).toBe("insecure_default_key");
  });

  test("refuses a value that is long enough to pass the schema but is not a 32-byte key", () => {
    const env = parseServerEnv({
      ...PROD_BASE,
      GROWTHMIND_ENCRYPTION_KEY: "!".repeat(44),
    });

    const result = resolveCredentialKey(env);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal, got a usable key");
    expect(result.reason).toBe("malformed_key");
  });
});
