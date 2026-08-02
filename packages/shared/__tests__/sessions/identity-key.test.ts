import { createHash, createHmac } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { deriveIdentityHmacKey, hashIdentityKey } from "../../src/sessions/identity-key";

const PROJECT_A = "s0-project-424242";
const PROJECT_B = "s0-project-999999";
const DISTINCT_ID = "s0-distinct-0001";

const KEY_A = deriveIdentityHmacKey({ bytes: new Uint8Array(32).fill(0x11) });
const KEY_B = deriveIdentityHmacKey({ bytes: new Uint8Array(32).fill(0x22) });

describe("hashIdentityKey", () => {
  test("is deterministic: the same key, project, and distinct id always produce the same, byte-identical digest", () => {
    const first = hashIdentityKey(KEY_A, PROJECT_A, DISTINCT_ID);
    const second = hashIdentityKey(KEY_A, PROJECT_A, DISTINCT_ID);
    expect(second).toBe(first);

    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  test("is project-salted: the same distinct id under a different project forks the digest", () => {
    const underA = hashIdentityKey(KEY_A, PROJECT_A, DISTINCT_ID);
    const underB = hashIdentityKey(KEY_A, PROJECT_B, DISTINCT_ID);
    expect(underB).not.toBe(underA);
  });

  test("never returns the raw input, even when the distinct id is email-shaped", () => {
    const emailShaped = "someone@s0-acme.invalid";
    const digest = hashIdentityKey(KEY_A, PROJECT_A, emailShaped);
    expect(digest).not.toContain(emailShaped);
    expect(digest).not.toContain("@");
    expect(digest).not.toContain(PROJECT_A);
  });

  test("a different distinct id under the same project forks the digest", () => {
    const first = hashIdentityKey(KEY_A, PROJECT_A, "s0-distinct-a");
    const second = hashIdentityKey(KEY_A, PROJECT_A, "s0-distinct-b");
    expect(second).not.toBe(first);
  });

  test("is KEYED: the same project and distinct id under a different key fork the digest", () => {
    const underKeyA = hashIdentityKey(KEY_A, PROJECT_A, DISTINCT_ID);
    const underKeyB = hashIdentityKey(KEY_B, PROJECT_A, DISTINCT_ID);
    expect(underKeyB).not.toBe(underKeyA);
  });

  test("is not reproducible from the public project id alone (not the old unkeyed sha256 scheme)", () => {
    const emailShaped = "someone@s0-acme.invalid";
    const digest = hashIdentityKey(KEY_A, PROJECT_A, emailShaped);
    const oldUnkeyedScheme = createHash("sha256")
      .update(`${PROJECT_A}:${emailShaped}`)
      .digest("hex");
    expect(digest).not.toBe(oldUnkeyedScheme);
  });

  test("matches a correctly-computed HMAC-SHA256 over the same message and key", () => {
    const digest = hashIdentityKey(KEY_A, PROJECT_A, DISTINCT_ID);
    const expected = createHmac("sha256", KEY_A.bytes)
      .update(`${PROJECT_A}:${DISTINCT_ID}`)
      .digest("hex");
    expect(digest).toBe(expected);
  });
});

describe("deriveIdentityHmacKey", () => {
  test("is deterministic: the same root encryption key always derives the same HMAC key", () => {
    const rootKey = { bytes: new Uint8Array(32).fill(0x33) };
    const first = deriveIdentityHmacKey(rootKey);
    const second = deriveIdentityHmacKey(rootKey);
    expect(Buffer.from(first.bytes)).toEqual(Buffer.from(second.bytes));
  });

  test("a different root encryption key derives a different HMAC key, forking every identity key under it", () => {
    const derivedFromA = deriveIdentityHmacKey({ bytes: new Uint8Array(32).fill(0x44) });
    const derivedFromB = deriveIdentityHmacKey({ bytes: new Uint8Array(32).fill(0x55) });
    expect(Buffer.from(derivedFromA.bytes)).not.toEqual(Buffer.from(derivedFromB.bytes));

    const underA = hashIdentityKey(derivedFromA, PROJECT_A, DISTINCT_ID);
    const underB = hashIdentityKey(derivedFromB, PROJECT_A, DISTINCT_ID);
    expect(underA).not.toBe(underB);
  });

  test("derives 32 bytes — HMAC-SHA256's natural key size", () => {
    const derived = deriveIdentityHmacKey({ bytes: new Uint8Array(32).fill(0x66) });
    expect(derived.bytes.length).toBe(32);
  });
});
