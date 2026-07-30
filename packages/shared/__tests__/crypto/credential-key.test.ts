// ADD §9 items 5–6 — the non-bypassable production gate on the
// credential-encryption key (O-003 D-1).
//
// The environments below are built with the REAL `parseServerEnv`, not a hand
// -rolled object literal: the whole point of item 5 is that a deployment which
// legitimately boots (because it set GROWTHMIND_ALLOW_INSECURE_DEFAULTS) still
// cannot store a third party's credential under the published key. Fabricating
// a `ServerEnv` by hand would skip the boot path the guard has to survive.
import { describe, expect, test } from "bun:test";

import { resolveCredentialKey } from "../../src/crypto/credential-key";
import { CREDENTIAL_KEY_BYTE_LENGTH } from "../../src/crypto/secret-box";
import { DEV_ENCRYPTION_KEY, parseServerEnv } from "../../src/env";

/** A production environment that is otherwise entirely legitimate. */
const PROD_BASE = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://s0-app:s0-placeholder@db.example.invalid:5432/growthmind",
  BETTER_AUTH_SECRET: "s0-fixture-auth-secret-not-a-real-one",
  BETTER_AUTH_URL: "https://s0-app.example.invalid",
} as const;

describe("resolveCredentialKey", () => {
  // Item 5 — the gate this decision exists for.
  test("refuses the published dev default in production even when GROWTHMIND_ALLOW_INSECURE_DEFAULTS is set", () => {
    // The bypass flag is what lets this environment boot at all: without it,
    // parseServerEnv rejects the published literal outright. So this is
    // precisely the deployment the second check has to stop.
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

  // Item 6 — the self-host promise the gate must not break.
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
      // 44 base64 chars of obviously-fake material — a structurally valid
      // AES-256 key that is not the published literal.
      GROWTHMIND_ENCRYPTION_KEY: "czAtZml4dHVyZS1lbmNyeXB0aW9uLWtleS0zMmJ5dGVzIQ==",
    });

    const result = resolveCredentialKey(env);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`expected a usable key, got ${result.reason}`);
    expect(result.key.bytes).toHaveLength(CREDENTIAL_KEY_BYTE_LENGTH);
  });

  test("refuses a value that is long enough to pass the schema but is not a 32-byte key", () => {
    // The schema only knows `min(44)`. Fail direction: a named refusal the
    // connection service maps to `misconfigured`, never a thrown exception
    // escaping into a poll loop.
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
