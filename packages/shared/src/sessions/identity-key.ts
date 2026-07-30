// Deterministic, project-salted, KEYED identity-key hashing
// (O-003 CR-5, security audit M-1).
//
// PostHog's `identify()` is routinely called with a user's email address as
// the `distinct_id` — that is how a lot of customer SDKs are wired, not an
// edge case. product-decisions §5 and PRD FR-16 both say only the email
// DOMAIN may ever cross a port boundary, never an address. The raw distinct
// id is still real signal — D-5's budgeted `/persons` lookup needs it in
// memory, and D-9's session grouping needs SOME stable key derived from it —
// so it cannot simply be dropped. It is hashed instead, once, at the point it
// is about to cross into a pull result or a derived session key
// (`packages/adapters/src/posthog/session-source.ts`).
//
// WHY A HASH, NOT AN EMAIL-SHAPED PREDICATE: an "if this looks like an email,
// strip it" classifier is exactly the D10 superset-miss hazard this sprint
// exists to prevent — it would only catch shapes it was shown, and this
// repo does not get to assume it has seen every distinct-id shape every
// PostHog customer's SDK will ever send. A uniform hash has no predicate to
// mis-fire, so there is nothing for a new shape to slip past.
//
// WHY PROJECT-SALTED: the message hashed is `sourceProjectId + ":" +
// distinctId`, which keeps the digest specific to one customer's project
// while staying byte-identical across runs for the SAME project + distinct id
// — which is what session grouping (`./grouping.ts`, D-9) and a later real
// identity stitcher (D12) both depend on: the hash must never fork for the
// same (project, distinct id) pair.
//
// M-1, WHY KEYED (not merely salted): this hash was originally an UNKEYED
// `sha256(sourceProjectId + ":" + distinctId)`. That was wrong, and its own
// justification said so on close reading — the file argued in one breath that
// `identify()` is "routinely called with a user's email address," and in the
// next that the input space is "not low-entropy secrets an attacker would
// brute-force." Both cannot be true: an email address IS exactly the kind of
// low-entropy, dictionary-guessable input a salt cannot protect, because the
// salt (`sourceProjectId`) is public — it is stored in plaintext one table
// over, in `project_connections`, and is typically a small integer. Anyone
// holding a database dump reverses every email-shaped identity key by
// dictionary in seconds, which defeats the entire reason this hash exists.
// The fix is a KEYED digest (HMAC-SHA256) whose key is never in the database,
// so a dump alone is not enough to run the dictionary attack — the input
// space no longer matters because there is no way to recompute candidate
// digests without the key.
//
// WHY DERIVED VIA HKDF FROM `GROWTHMIND_ENCRYPTION_KEY` (no new env var): a
// second required secret is a second self-host setup step, and
// `GROWTHMIND_ENCRYPTION_KEY` already exists with a dev default and a
// production guard (`../crypto/credential-key.ts`, D-1) — reusing it costs
// nothing new to configure. `deriveIdentityHmacKey` runs it through HKDF-
// SHA256 under a context string (`HKDF_INFO`) distinct from any other use of
// that root key, so a compromise of the derived identity key does not hand
// over the credential-encryption key or vice versa — HKDF's whole purpose is
// exactly this domain separation from one root secret.
//
// ROTATION CONSEQUENCE, STATED (D12): rotating `GROWTHMIND_ENCRYPTION_KEY`
// forks EVERY identity key derived under the old one — the digest for the
// same (project, distinct id) pair changes the moment the key changes,
// exactly like a `grouping_version` or `URL_PATH_NORMALISATION_VERSION` bump
// forks stored meaning. No connection has ever completed a poll in
// production as of this fix (O-003 has not shipped), so today the cost of
// that fork is zero — there are no rows to migrate. That is a closing window,
// not a standing exemption: the day a real customer's rows exist, rotating
// this key becomes an identity-fork event with a real cost, and this comment
// is the marker for whoever adds the ancestry/migration path D12 asks for
// before that day arrives.
import { createHmac, hkdfSync } from "node:crypto";

import type { CredentialKey } from "../crypto/secret-box";

/** RFC 5869 `info` — the HKDF context string that cryptographically separates
 * this derived key from any other key ever derived from the same root
 * secret. A distinct, versioned literal (never reused for another purpose)
 * is what makes that separation actually hold. */
const HKDF_INFO = "growthmind:session-source:identity-key:v1";

/** HMAC-SHA256's natural key size — SHA-256's own output width, and the
 * length HKDF's expand step is asked to produce. */
const IDENTITY_HMAC_KEY_BYTE_LENGTH = 32;

/** A derived HMAC key. Distinguished from `CredentialKey` (`../crypto/secret-
 * box.ts`) as its own type — despite an identical shape today — so a future
 * change to either key's derivation cannot be papered over by an accidental
 * structural match. */
export interface IdentityHmacKey {
  readonly bytes: Uint8Array;
}

/**
 * Derives the keyed hasher's HMAC key from the installation's own
 * `GROWTHMIND_ENCRYPTION_KEY` (already resolved to a `CredentialKey` by
 * `resolveCredentialKey`, `../crypto/credential-key.ts`) via HKDF-SHA256.
 *
 * Called ONCE per adapter construction (the composition root — worker's
 * `session-source-poll.ts` today), never per event: `hashIdentityKey` below
 * is the hot-path function and takes the already-derived key, not the root
 * secret, so it never re-runs HKDF per call.
 */
export function deriveIdentityHmacKey(encryptionKey: CredentialKey): IdentityHmacKey {
  const derived = hkdfSync(
    "sha256",
    encryptionKey.bytes,
    // No salt: the input key material is already high-entropy random bytes
    // (an AES-256 key), so a random salt would add no security HKDF's own
    // extract step doesn't already provide from that input.
    new Uint8Array(0),
    HKDF_INFO,
    IDENTITY_HMAC_KEY_BYTE_LENGTH,
  );
  return { bytes: new Uint8Array(derived) };
}

/**
 * `HMAC-SHA256(key, sourceProjectId + ":" + distinctId)`, hex-encoded.
 * Deterministic and stable forever for a given (key, project, distinct id)
 * triple (D12) — the same inputs always produce the same digest, byte-
 * identical, so a persisted row can always be re-derived from its own facts
 * for as long as the key is unchanged. See the file header for what changes
 * when the key IS rotated.
 *
 * This is a lookup/grouping key, not a password hash: the concern is not
 * brute-forcing a single high-entropy input, it is a dictionary attack
 * against a whole database of digests using a salt (the project id) that is
 * public — which is exactly what keying (M-1), not merely salting, closes.
 * A fast keyed MAC is the right tool for that; a slow KDF defends a different
 * threat model (protecting one guessed password from one guess at a time),
 * not this one.
 */
export function hashIdentityKey(
  key: IdentityHmacKey,
  sourceProjectId: string,
  distinctId: string,
): string {
  return createHmac("sha256", key.bytes).update(`${sourceProjectId}:${distinctId}`).digest("hex");
}
