// AES-256-GCM envelope encryption for third-party credentials (O-003 D-1).
//
// `hashWriteKeyMaterial` (SHA-256, one-way) is the only other crypto in this
// repo and structurally cannot serve here: the adapter must present the
// customer's PostHog personal API key back to PostHog on every poll, so the
// stored form has to be recoverable.
//
// Implemented in Wave 1 against the scaffold's final signatures.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * A validated 32-byte AES-256 key. Built only by
 * `resolveCredentialKey` (./credential-key.ts) so no call site can hand a
 * raw string of the wrong length to `encryptSecret`.
 */
export interface CredentialKey {
  readonly bytes: Uint8Array;
}

/** Reserves the algorithm change. A `v2.` envelope is a migratable event. */
export const ENVELOPE_VERSION = "v1";

/** 96-bit IV, the AES-GCM standard nonce size. */
export const IV_BYTE_LENGTH = 12;

/** 128-bit authentication tag. */
export const AUTH_TAG_BYTE_LENGTH = 16;

/** An AES-256 key is 32 bytes; base64 of 32 bytes is 44 chars. */
export const CREDENTIAL_KEY_BYTE_LENGTH = 32;

/**
 * Named decryption failures. `decryptSecret` NEVER throws across this
 * boundary — a credential that cannot be read is a `misconfigured` refusal
 * with a plain-English message (F-11 fails closed), not an exception that
 * escapes into a poll loop.
 */
export type DecryptFailureReason =
  "malformed_envelope" | "unsupported_version" | "key_id_mismatch" | "authentication_failed";

export type DecryptResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: DecryptFailureReason };

/**
 * The additional authenticated data binding a ciphertext to the row that owns
 * it: `` `${organizationId}:${projectId}` ``. A ciphertext lifted from one
 * org's row into another's fails authentication rather than decrypting — a
 * structural cross-tenant guard on the credential itself (D7). Connections
 * never move between projects, so this is stable for the row's lifetime.
 *
 * The format is a cross-boundary literal (D9) and therefore has exactly one
 * home: this function.
 */
export function credentialAad(organizationId: string, projectId: string): string {
  return `${organizationId}:${projectId}`;
}

/**
 * The first 8 hex chars of `sha256(key bytes)` — a fingerprint, NEVER the
 * key. Its purpose is that a row encrypted under a retired key is
 * *identifiable* rather than an opaque decrypt failure, so key rotation
 * becomes a migratable event instead of a D12 identity fork.
 */
export function keyIdOf(key: CredentialKey): string {
  return createHash("sha256").update(key.bytes).digest("hex").slice(0, KEY_ID_HEX_LENGTH);
}

/** The fingerprint's width. 8 hex chars is enough to tell two live keys apart
 * in a `WHERE credential_key_id = …` sweep, and far too little to attack. */
const KEY_ID_HEX_LENGTH = 8;

/** The envelope's five dot-separated fields. Split, never regex-parsed, so a
 * malformed value is a length check rather than a silent partial match. */
const ENVELOPE_FIELD_COUNT = 5;

/**
 * Returns the self-describing envelope
 * `` `v1.${keyId}.${ivB64url}.${tagB64url}.${ciphertextB64url}` `` — one
 * `text` column, no side table, no ambiguity about which key wrote it.
 */
export function encryptSecret(plaintext: string, key: CredentialKey, aad: string): string {
  // A fresh 96-bit IV per call. A deterministic ciphertext would leak "these
  // two organizations pasted the same key" straight out of the column.
  const iv = randomBytes(IV_BYTE_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key.bytes, iv, {
    authTagLength: AUTH_TAG_BYTE_LENGTH,
  });
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    ENVELOPE_VERSION,
    keyIdOf(key),
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * Reads an envelope produced by `encryptSecret`. Fails as a NAMED result —
 * never a throw — for a malformed envelope, an unknown version, a key whose
 * fingerprint does not match the envelope's `keyId`, or an authentication
 * failure (which is what a mismatched AAD produces).
 */
export function decryptSecret(envelope: string, key: CredentialKey, aad: string): DecryptResult {
  const fields = envelope.split(".");
  if (fields.length !== ENVELOPE_FIELD_COUNT) return { ok: false, reason: "malformed_envelope" };

  const [version, envelopeKeyId, ivField, tagField, ciphertextField] = fields as [
    string,
    string,
    string,
    string,
    string,
  ];

  // Version before key id: a `v2.` envelope written by a future algorithm is
  // not a rotation casualty, and must not be reported as one.
  if (version !== ENVELOPE_VERSION) return { ok: false, reason: "unsupported_version" };

  // FAIL DIRECTION (F-11): closed. A row written under a retired key is
  // IDENTIFIABLE here rather than surfacing as an opaque authentication
  // failure — which is the entire reason the envelope carries a fingerprint.
  // There is deliberately no fallback to any other key.
  if (envelopeKeyId !== keyIdOf(key)) return { ok: false, reason: "key_id_mismatch" };

  const iv = decodeBase64Url(ivField, IV_BYTE_LENGTH);
  const tag = decodeBase64Url(tagField, AUTH_TAG_BYTE_LENGTH);
  const ciphertext = decodeBase64Url(ciphertextField);
  if (!iv || !tag || !ciphertext) return { ok: false, reason: "malformed_envelope" };

  try {
    const decipher = createDecipheriv("aes-256-gcm", key.bytes, iv, {
      authTagLength: AUTH_TAG_BYTE_LENGTH,
    });
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return { ok: true, value: plaintext.toString("utf8") };
  } catch {
    // The D7 guard lands here: an AAD naming a different organization fails
    // authentication. A named result, never a throw escaping into a poll loop.
    return { ok: false, reason: "authentication_failed" };
  }
}

/**
 * Strict base64url decode. `Buffer.from` silently discards characters it does
 * not recognise, so a corrupted field would otherwise decode to a shorter
 * buffer and read as ordinary data rather than as damage.
 *
 * An empty FIELD is malformed for the IV and auth tag — both callers always
 * pass `expectedLength` for those, and a fixed-width field can never
 * legitimately be empty. The ciphertext field is the one exception (CR-7):
 * `encryptSecret("")` produces a zero-length ciphertext (AES-GCM's ciphertext
 * is exactly as long as the plaintext), so its caller never passes
 * `expectedLength`, and an empty ciphertext field there is round-tripped, not
 * rejected as `malformed_envelope`. A customer who pastes nothing gets that
 * distinguished upstream of encryption, not read back as corruption.
 */
function decodeBase64Url(field: string, expectedLength?: number): Buffer | null {
  if (field.length === 0) return expectedLength === undefined ? Buffer.alloc(0) : null;
  if (!/^[A-Za-z0-9_-]+$/.test(field)) return null;
  const decoded = Buffer.from(field, "base64url");
  if (decoded.length === 0) return null;
  if (expectedLength !== undefined && decoded.length !== expectedLength) return null;
  return decoded;
}
