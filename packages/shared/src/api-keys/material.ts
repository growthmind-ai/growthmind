// Read-credential material. Structurally a mirror of `../write-keys/material.ts` and
// deliberately sharing nothing with it: the two families sit at different trust levels.
// A write key is public by construction. It ships in the customer's page source. A read
// credential is handed by a person to their coding agent and never published, and it
// addresses every finding, count and fix instruction in the organisation.
//
// The duplication is therefore intent, not divergence: there is no behaviour to differ
// today, and a named row in `__tests__/api-keys/material.test.ts` asserts
// `hashApiKeyMaterial === hashWriteKeyMaterial` so any future salt/pepper/kdf on
// either side is a deliberate, visible change that fails a test, rather than one that
// silently invalidates every stored `write_keys` row, or quietly leaves a secret family
// hashed like a public one.
//
// Pure: `node:crypto` only. No clock, no network, no database, so this module travels
// unchanged if the MCP surface ever moves to its own package.
import { createHash } from "node:crypto";

/**
 * Prefix for all minted read-credential material. It differs from `WRITE_KEY_PREFIX`
 * (`gmwk_`) at index 2, so no substring match or regex over one family can ever fire on
 * the other, and a wrong-family key is refused at the format check below, before any
 * database access, in both directions.
 */
export const API_KEY_PREFIX = "gmak_";

/**
 * `"gmak_"` + exactly six characters of material. Eleven, not `write_keys`' twelve.
 * That column's comment justifies twelve as "a truncated prefix of a
 * spoofable-by-design public key, no secrecy cost"; this material is a secret, so the
 * justification does not transfer. Six characters (~68 billion combinations against an
 * organisation holding a handful of keys) is collision-free in practice at half the
 * exposure in terminal scrollback, and the stored value still carries the scheme,
 * `gmak_x7Kq2p` is self-describing wherever it is printed.
 */
export const API_KEY_DISPLAY_PREFIX_LENGTH = 11;

/** Exactly 43 base64url characters. The length a real 256-bit key encodes to. */
const API_KEY_FORMAT = new RegExp(`^${API_KEY_PREFIX}[A-Za-z0-9_-]{43}$`);

/**
 * Fail-closed pre-filter: true only for a syntactically well-formed presented
 * credential (correct prefix, correct length/charset). Never throws on malformed input.
 * A credential gate that throws on hostile input is a 500, not a refusal.
 *
 * It does not trim, deliberately. `presentedCredential`
 * (apps/web/lib/mcp/credentials.ts) does not trim either, so `Bearer gmak_…` presents a
 * leading space and is refused here. Widening this format to "helpfully" accept it
 * would widen what counts as a credential.
 */
export function isApiKeyFormat(value: string): boolean {
  return API_KEY_FORMAT.test(value);
}

/**
 * Deterministic SHA-256 hex digest of the raw credential material (node:crypto). The
 * material is high-entropy random (256-bit), so a fast deterministic hash is correct
 * here. This is a lookup key, not a password hash.
 */
export function hashApiKeyMaterial(material: string): string {
  return createHash("sha256").update(material).digest("hex");
}
