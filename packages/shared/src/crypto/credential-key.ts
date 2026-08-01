// The non-bypassable production gate on the credential-encryption key.
//
// `GROWTHMIND_ALLOW_INSECURE_DEFAULTS=1` exists so the quickstart compose stack boots
// from a clean clone. It must not extend to encrypting a third party's real secret:
// BETTER_AUTH_SECRET's blast radius is this deployment's own sessions, while this key's
// blast radius is the customer's PostHog account. So the check lives here, at the
// encryption call site, rather than at boot. A self-hoster with no PostHog still boots
// and passes the gate; a self-hoster who tries to store a PostHog credential under the
// published key is stopped with an instruction.
//
// Implemented in Wave 1 against the scaffold's final signatures.
import { timingSafeEqual } from "node:crypto";

import { DEV_ENCRYPTION_KEY } from "../env";
import type { ServerEnv } from "../env";
import { CREDENTIAL_KEY_BYTE_LENGTH } from "./secret-box";
import type { CredentialKey } from "./secret-box";

export type CredentialKeyFailureReason = "insecure_default_key" | "malformed_key";

export type CredentialKeyResolution =
  | { readonly ok: true; readonly key: CredentialKey }
  | { readonly ok: false; readonly reason: CredentialKeyFailureReason };

/**
 * Resolves `env.GROWTHMIND_ENCRYPTION_KEY` into a usable 32-byte key.
 *
 * Fail directions:
 * `NODE_ENV === "production"` and the value byte-equals `DEV_ENCRYPTION_KEY` ⇒
 *  `insecure_default_key`, **regardless of GROWTHMIND_ALLOW_INSECURE_DEFAULTS**. This
 *  is the whole point of the function.
 * Not base64, or not exactly `CREDENTIAL_KEY_BYTE_LENGTH` bytes once decoded ⇒
 *  `malformed_key`.
 *
 * The connection service maps either refusal to a `misconfigured` state whose
 * customer-facing message names the one step that fixes it.
 */
export function resolveCredentialKey(env: ServerEnv): CredentialKeyResolution {
  const configured = env.GROWTHMIND_ENCRYPTION_KEY.trim();

  // Fail direction: closed, and first. Exact-literal match, before any decoding. This
  // check is deliberately not gated on GROWTHMIND_ALLOW_INSECURE_DEFAULTS and
  // deliberately not reachable-around by any later branch. A production deployment that
  // legitimately boots under the bypass flag still may not store a third party's
  // credential under a key published in a public repository.
  if (env.NODE_ENV === "production" && configured === DEV_ENCRYPTION_KEY.trim()) {
    return { ok: false, reason: "insecure_default_key" };
  }

  const material = decodeBase64Strict(configured);
  if (!material || material.length < CREDENTIAL_KEY_BYTE_LENGTH) {
    // Fail direction: closed, as a named result. The connection service maps this to a
    // `misconfigured` refusal naming the one step that fixes it, never a thrown
    // exception escaping into a poll loop.
    return { ok: false, reason: "malformed_key" };
  }

  // `openssl rand -base64 32` (the instruction.env.example gives) produces exactly
  // CREDENTIAL_KEY_BYTE_LENGTH bytes. A longer value is strictly more secret material,
  // not less, so it is accepted and its first 32 bytes are used rather than stranding a
  // deployment on a working secret. A shorter one is refused above: AES-256 has one key
  // length.
  const keyBytes = new Uint8Array(material.subarray(0, CREDENTIAL_KEY_BYTE_LENGTH));

  // Fail direction: closed, and checked against the same 32 bytes that will actually be
  // used (`keyBytes`), never the raw decoded input. A configured value of "the
  // published dev key plus an arbitrary suffix" decodes to a byte length that does not
  // match the dev key's, so a comparison gated on equal lengths against the *raw*
  // decoded input lets it through, and it is then silently truncated back down to
  // exactly the published dev key by the `subarray` above. Comparing the
  // already-truncated `keyBytes` closes that regardless of what garbage a suffix adds.
  if (env.NODE_ENV === "production" && isPublishedDevKeyBytes(keyBytes)) {
    return { ok: false, reason: "insecure_default_key" };
  }

  return { ok: true, key: { bytes: keyBytes } };
}

/**
 * Compares an already-truncated `CREDENTIAL_KEY_BYTE_LENGTH`-byte key against the
 * published literal's decoded form, by value, so re-encoding the same 32 bytes
 * (base64url, extra padding) cannot walk past the gate.
 */
function isPublishedDevKeyBytes(keyBytes: Uint8Array): boolean {
  const devBytes = decodeBase64Strict(DEV_ENCRYPTION_KEY.trim());
  if (!devBytes || devBytes.length !== CREDENTIAL_KEY_BYTE_LENGTH) return false;
  if (keyBytes.length !== devBytes.length) return false;
  return timingSafeEqual(keyBytes, devBytes);
}

/**
 * `Buffer.from(value, "base64")` silently discards every character it does not
 * recognise, so `"!!!!…"` decodes to an empty buffer rather than failing. That turns a
 * typo into a zero-length key, so the alphabet is checked first.
 */
function decodeBase64Strict(value: string): Buffer | null {
  if (value.length === 0) return null;
  const normalised = value.replaceAll("-", "+").replaceAll("_", "/");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalised)) return null;
  const decoded = Buffer.from(normalised, "base64");
  return decoded.length === 0 ? null : decoded;
}
