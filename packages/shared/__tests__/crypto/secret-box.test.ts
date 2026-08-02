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

const PLAINTEXT = "s0-placeholder-credential-value-not-a-real-key";

describe("credentialAad", () => {
  test("binds a ciphertext to one organization and project", () => {
    expect(AAD_A).toBe(`${ORG_A}:${PROJECT}`);

    expect(AAD_A).not.toBe(AAD_B);
  });
});

describe("encryptSecret / decryptSecret", () => {
  test("encrypts and decrypts a credential round-trip under the same key and aad", () => {
    const envelope = encryptSecret(PLAINTEXT, KEY_A, AAD_A);

    expect(envelope).not.toContain(PLAINTEXT);

    const result = decryptSecret(envelope, KEY_A, AAD_A);
    expect(result).toEqual({ ok: true, value: PLAINTEXT });
  });

  test("round-trips an empty plaintext instead of reading it back as a malformed envelope", () => {
    const envelope = encryptSecret("", KEY_A, AAD_A);
    const parts = envelope.split(".");
    expect(parts).toHaveLength(5);
    expect(parts[4]).toBe("");

    const result = decryptSecret(envelope, KEY_A, AAD_A);
    expect(result).toEqual({ ok: true, value: "" });
  });

  test("two encryptions of the same plaintext differ, because the iv is random per call", () => {
    expect(encryptSecret(PLAINTEXT, KEY_A, AAD_A)).not.toBe(encryptSecret(PLAINTEXT, KEY_A, AAD_A));
  });

  test("decryption fails as a named result — never a throw — when the aad names a different organization", () => {
    const envelope = encryptSecret(PLAINTEXT, KEY_A, AAD_A);

    const result = decryptSecret(envelope, KEY_A, AAD_B);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failure result, got a decrypted value");
    expect(result.reason).toBe("authentication_failed");
  });

  test("decryption fails as a named result when the envelope was written under a different key id", () => {
    const envelope = encryptSecret(PLAINTEXT, KEY_A, AAD_A);

    const result = decryptSecret(envelope, KEY_B, AAD_A);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failure result, got a decrypted value");

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
  test("envelope is versioned and carries a key fingerprint, never the key", () => {
    const envelope = encryptSecret(PLAINTEXT, KEY_A, AAD_A);
    const parts = envelope.split(".");

    expect(parts).toHaveLength(5);

    const [version, keyId, iv, tag, ciphertext] = parts;
    expect(version).toBe(ENVELOPE_VERSION);

    expect(keyId).toBe(keyIdOf(KEY_A));
    expect(keyId).toMatch(/^[0-9a-f]{8}$/);

    expect(iv).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(tag).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(ciphertext).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(iv ?? "", "base64url")).toHaveLength(IV_BYTE_LENGTH);
    expect(Buffer.from(tag ?? "", "base64url")).toHaveLength(AUTH_TAG_BYTE_LENGTH);

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
