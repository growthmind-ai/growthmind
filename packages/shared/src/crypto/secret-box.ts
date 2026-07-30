// AES-256-GCM envelope encryption for third-party credentials (O-003 D-1).
//
// `hashWriteKeyMaterial` (SHA-256, one-way) is the only other crypto in this
// repo and structurally cannot serve here: the adapter must present the
// customer's PostHog personal API key back to PostHog on every poll, so the
// stored form has to be recoverable.
//
// TYPED STUB (O-003 scaffold): the type declarations, the envelope format,
// and the failure vocabulary below are FINAL — tests assert against them.
// Function bodies throw; Wave 1 fills them in against these exact signatures.

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
export function keyIdOf(_key: CredentialKey): string {
  throw new Error("TYPED STUB (O-003 scaffold): keyIdOf");
}

/**
 * Returns the self-describing envelope
 * `` `v1.${keyId}.${ivB64url}.${tagB64url}.${ciphertextB64url}` `` — one
 * `text` column, no side table, no ambiguity about which key wrote it.
 */
export function encryptSecret(_plaintext: string, _key: CredentialKey, _aad: string): string {
  throw new Error("TYPED STUB (O-003 scaffold): encryptSecret");
}

/**
 * Reads an envelope produced by `encryptSecret`. Fails as a NAMED result —
 * never a throw — for a malformed envelope, an unknown version, a key whose
 * fingerprint does not match the envelope's `keyId`, or an authentication
 * failure (which is what a mismatched AAD produces).
 */
export function decryptSecret(_envelope: string, _key: CredentialKey, _aad: string): DecryptResult {
  throw new Error("TYPED STUB (O-003 scaffold): decryptSecret");
}
