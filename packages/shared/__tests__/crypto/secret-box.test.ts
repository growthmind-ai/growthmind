// ADD §9 items 1–4 — the credential envelope (O-003 D-1 / FR-7 / D7 / D12).
//
// Fixture discipline: lane seed prefix `s0-`. Every value here is an obviously
// fake placeholder — this repo is public and nothing resembling a real
// PostHog personal key may appear in it.
import { describe, expect, test } from "bun:test";

import {
  AUTH_TAG_BYTE_LENGTH,
  CREDENTIAL_KEY_BYTE_LENGTH,
  ENVELOPE_VERSION,
  IV_BYTE_LENGTH,
  credentialAad,
  decryptSecret,
  encryptSecret,
  keyIdOf,
} from "../../src/crypto/secret-box";
import type { CredentialKey } from "../../src/crypto/secret-box";

/**
 * `CredentialKey` is a public shape (`{ readonly bytes: Uint8Array }`), so a
 * test can build one directly rather than reaching through
 * `resolveCredentialKey` — which has its own suite and its own failure modes.
 */
function fakeKey(fill: number): CredentialKey {
  return { bytes: new Uint8Array(CREDENTIAL_KEY_BYTE_LENGTH).fill(fill) };
}

const KEY_A = fakeKey(0x11);
const KEY_B = fakeKey(0x22);

const ORG_A = "s0-org-aaaaaaaa";
const ORG_B = "s0-org-bbbbbbbb";
const PROJECT = "s0-project-00000001";

const AAD_A = credentialAad(ORG_A, PROJECT);
const AAD_B = credentialAad(ORG_B, PROJECT);

/** Not a credential. A placeholder standing where one would be. */
const PLAINTEXT = "s0-placeholder-credential-value-not-a-real-key";

describe("credentialAad", () => {
  test("binds a ciphertext to one organization and project", () => {
    expect(AAD_A).toBe(`${ORG_A}:${PROJECT}`);
    // The whole D7 guard rests on two orgs never producing the same AAD.
    expect(AAD_A).not.toBe(AAD_B);
  });
});

describe("encryptSecret / decryptSecret", () => {
  // Item 1
  test("encrypts and decrypts a credential round-trip under the same key and aad", () => {
    const envelope = encryptSecret(PLAINTEXT, KEY_A, AAD_A);

    expect(envelope).not.toContain(PLAINTEXT);

    const result = decryptSecret(envelope, KEY_A, AAD_A);
    expect(result).toEqual({ ok: true, value: PLAINTEXT });
  });

  test("two encryptions of the same plaintext differ, because the iv is random per call", () => {
    // A deterministic ciphertext would leak "these two orgs pasted the same
    // key" straight out of the column.
    expect(encryptSecret(PLAINTEXT, KEY_A, AAD_A)).not.toBe(
      encryptSecret(PLAINTEXT, KEY_A, AAD_A),
    );
  });

  // Item 2 — D7
  test("decryption fails as a named result — never a throw — when the aad names a different organization", () => {
    const envelope = encryptSecret(PLAINTEXT, KEY_A, AAD_A);

    // The structural cross-tenant guard: org B lifts org A's ciphertext into
    // its own row and gets a refusal, not a credential.
    const result = decryptSecret(envelope, KEY_A, AAD_B);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failure result, got a decrypted value");
    expect(result.reason).toBe("authentication_failed");
  });

  // Item 3 — F-11 (fail closed)
  test("decryption fails as a named result when the envelope was written under a different key id", () => {
    const envelope = encryptSecret(PLAINTEXT, KEY_A, AAD_A);

    const result = decryptSecret(envelope, KEY_B, AAD_A);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failure result, got a decrypted value");
    // Identifiable as a rotation casualty, not an opaque authentication error:
    // that distinction is the entire reason the envelope carries a keyId.
    expect(result.reason).toBe("key_id_mismatch");
  });

  test("a malformed envelope is a named result, never a throw", () => {
    for (const malformed of ["", "not-an-envelope", "v1.only.three.parts", "v9.aaaaaaaa.a.b.c"]) {
      const result = decryptSecret(malformed, KEY_A, AAD_A);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error(`expected a failure result for ${JSON.stringify(malformed)}`);
      expect(["malformed_envelope", "unsupported_version"]).toContain(result.reason);
    }
  });
});

describe("the envelope format", () => {
  // Item 4 — D12
  test("envelope is versioned and carries a key fingerprint, never the key", () => {
    const envelope = encryptSecret(PLAINTEXT, KEY_A, AAD_A);
    const parts = envelope.split(".");

    expect(parts).toHaveLength(5);

    const [version, keyId, iv, tag, ciphertext] = parts;
    expect(version).toBe(ENVELOPE_VERSION);

    // A fingerprint — the first 8 hex chars of sha256(key) — so a row written
    // under a retired key is findable rather than an opaque failure.
    expect(keyId).toBe(keyIdOf(KEY_A));
    expect(keyId).toMatch(/^[0-9a-f]{8}$/);

    // base64url of a 12-byte iv and a 16-byte tag: no padding, no + or /.
    expect(iv).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(tag).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(ciphertext).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(iv ?? "", "base64url")).toHaveLength(IV_BYTE_LENGTH);
    expect(Buffer.from(tag ?? "", "base64url")).toHaveLength(AUTH_TAG_BYTE_LENGTH);

    // The key itself must not be recoverable from the stored column in any
    // encoding we hand out.
    const keyBase64 = Buffer.from(KEY_A.bytes).toString("base64");
    const keyBase64Url = Buffer.from(KEY_A.bytes).toString("base64url");
    const keyHex = Buffer.from(KEY_A.bytes).toString("hex");
    expect(envelope).not.toContain(keyBase64);
    expect(envelope).not.toContain(keyBase64Url);
    expect(envelope).not.toContain(keyHex);
    expect(keyIdOf(KEY_A)).not.toContain(keyHex);
  });

  test("keyIdOf is a stable fingerprint that distinguishes two keys", () => {
    expect(keyIdOf(KEY_A)).toBe(keyIdOf(KEY_A));
    expect(keyIdOf(KEY_A)).not.toBe(keyIdOf(KEY_B));
  });
});
