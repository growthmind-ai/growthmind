import { createHash } from "node:crypto";

/** Prefix for all minted write-key material. Public-by-design, no secrecy cost. */
export const WRITE_KEY_PREFIX = "gmwk_";

/** Exactly 43 base64url characters. The length a real 256-bit key encodes to. */
const WRITE_KEY_FORMAT = new RegExp(`^${WRITE_KEY_PREFIX}[A-Za-z0-9_-]{43}$`);

/**
 * Fail-closed pre-filter: true only for a syntactically well-formed presented key
 * (correct prefix, correct length/charset). Never throws on malformed input.
 */
export function isWriteKeyFormat(value: string): boolean {
  return WRITE_KEY_FORMAT.test(value);
}

/**
 * Deterministic SHA-256 hex digest of the raw key material (node:crypto). The material
 * is high-entropy random (256-bit), so a fast deterministic hash is correct here. This
 * is a lookup key, not a password hash.
 */
export function hashWriteKeyMaterial(material: string): string {
  return createHash("sha256").update(material).digest("hex");
}
