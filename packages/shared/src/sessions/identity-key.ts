// Deterministic, project-salted identity-key hashing (O-003 CR-5).
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
// WHY PROJECT-SALTED: `sha256(distinctId)` alone would let anyone holding a
// rainbow table of common distinct ids (emails, usernames) reverse it across
// every customer in the database at once. Salting with the PostHog project id
// keeps the digest specific to one customer's project, while staying
// byte-identical across runs for the SAME project + distinct id — which is
// what session grouping (`./grouping.ts`, D-9) and a later real identity
// stitcher (D12) both depend on: the hash must never fork for the same
// (project, distinct id) pair.
import { createHash } from "node:crypto";

/**
 * `sha256(sourceProjectId + ":" + distinctId)`, hex-encoded. Deterministic
 * and stable forever for a given (project, distinct id) pair (D12) — the
 * same two inputs always produce the same digest, byte-identical, so a
 * persisted row can always be re-derived from its own facts.
 *
 * This is a lookup/grouping key, not a password hash: the input space is
 * PostHog's own opaque distinct ids, not low-entropy secrets an attacker
 * would brute-force, so a fast deterministic digest (matching
 * `hashWriteKeyMaterial` in `../write-keys/material.ts`) is the right tool,
 * not a slow KDF.
 */
export function hashIdentityKey(sourceProjectId: string, distinctId: string): string {
  return createHash("sha256").update(`${sourceProjectId}:${distinctId}`).digest("hex");
}
