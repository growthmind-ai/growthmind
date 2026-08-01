// Security audit. Deterministic, project-salted, keyed identity-key hashing.
//
// PostHog's `identify` is routinely called with a user's email address as the
// `distinct_id`, so the raw value can carry PII. Only a hash of it may ever be
// persisted or cross a port boundary (product-decisions).: the original hash was
// unkeyed and salted only with the project id (public, plaintext, one table over) so an
// email-shaped digest was reversible by dictionary in seconds from a database dump. The
// keyed-ness tests below are what would have caught that.
import { createHash, createHmac } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { deriveIdentityHmacKey, hashIdentityKey } from "../../src/sessions/identity-key";

const PROJECT_A = "s0-project-424242";
const PROJECT_B = "s0-project-999999";
const DISTINCT_ID = "s0-distinct-0001";

/** Two distinct 32-byte fixture keys, so a test can prove the digest is a function of
 * the key, not merely of the (project, distinct id) pair. Obviously-fake fixture bytes,
 * this repo is public. */
const KEY_A = deriveIdentityHmacKey({ bytes: new Uint8Array(32).fill(0x11) });
const KEY_B = deriveIdentityHmacKey({ bytes: new Uint8Array(32).fill(0x22) });

describe("hashIdentityKey", () => {
  test("is deterministic: the same key, project, and distinct id always produce the same, byte-identical digest", () => {
    const first = hashIdentityKey(KEY_A, PROJECT_A, DISTINCT_ID);
    const second = hashIdentityKey(KEY_A, PROJECT_A, DISTINCT_ID);
    expect(second).toBe(first);
    // A hex HMAC-SHA256 digest, so a later real identity stitcher can rely on the shape
    // as well as the value.
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

  // , the fix's whole point.
  test("is KEYED: the same project and distinct id under a different key fork the digest", () => {
    const underKeyA = hashIdentityKey(KEY_A, PROJECT_A, DISTINCT_ID);
    const underKeyB = hashIdentityKey(KEY_B, PROJECT_A, DISTINCT_ID);
    expect(underKeyB).not.toBe(underKeyA);
  });

  // , the regression test for the actual reported hazard: without a key, anyone
  // holding a database dump can dictionary-attack every email-shaped distinct id
  // because the project-id salt is public. This proves the digest is no longer the old
  // unkeyed scheme, which any attacker with the (public) project id could otherwise
  // recompute for a whole email dictionary in seconds.
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

  // Named explicitly, so the rotation consequence documented in identity-key.ts's
  // header is a tested fact, not just a comment.
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
