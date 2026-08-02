import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export interface CredentialKey {
  readonly bytes: Uint8Array;
}

export const ENVELOPE_VERSION = "v1";

export const IV_BYTE_LENGTH = 12;

export const AUTH_TAG_BYTE_LENGTH = 16;

export const CREDENTIAL_KEY_BYTE_LENGTH = 32;

export type DecryptFailureReason =
  "malformed_envelope" | "unsupported_version" | "key_id_mismatch" | "authentication_failed";

export type DecryptResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: DecryptFailureReason };

export function credentialAad(organizationId: string, projectId: string): string {
  return `${organizationId}:${projectId}`;
}

export function keyIdOf(key: CredentialKey): string {
  return createHash("sha256").update(key.bytes).digest("hex").slice(0, KEY_ID_HEX_LENGTH);
}

const KEY_ID_HEX_LENGTH = 8;

const ENVELOPE_FIELD_COUNT = 5;

export function encryptSecret(plaintext: string, key: CredentialKey, aad: string): string {
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

  if (version !== ENVELOPE_VERSION) return { ok: false, reason: "unsupported_version" };

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
    return { ok: false, reason: "authentication_failed" };
  }
}

function decodeBase64Url(field: string, expectedLength?: number): Buffer | null {
  if (field.length === 0) return expectedLength === undefined ? Buffer.alloc(0) : null;
  if (!/^[A-Za-z0-9_-]+$/.test(field)) return null;
  const decoded = Buffer.from(field, "base64url");
  if (decoded.length === 0) return null;
  if (expectedLength !== undefined && decoded.length !== expectedLength) return null;
  return decoded;
}
