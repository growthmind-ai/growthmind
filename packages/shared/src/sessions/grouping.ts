// Session grouping (O-003 D-9, FR-26) — fork-proof by construction.
//
// TYPED STUB (O-003 scaffold): the constants are REAL and final;
// `deriveSessionKey`'s signature is final and its body throws.

/** Bump when the rules below change, so a stamp's provenance is readable
 * from the row rather than inferred from a deploy date (D12). Persisted per
 * session as `grouping_version`. */
export const SESSION_GROUPING_VERSION = 1;

/**
 * A FIXED 30-minute bucket, deliberately not a sliding inactivity gap. A
 * sliding window shifts as late events arrive, which would fork the key for
 * a session already on record — a textbook D12 churn. A fixed bucket is
 * deterministic regardless of arrival order.
 *
 * Trade-off named and accepted: a session spanning a bucket boundary splits
 * in two. FR-26 requires only that a later real stitcher can re-derive from
 * persisted facts, and both `identity_key` and `occurred_at` are persisted.
 */
export const SESSION_BUCKET_MS = 30 * 60_000;

export interface SessionKeyInput {
  /** PostHog's `$session_id` when the customer's SDK set one (SEC-C: it is
   * SDK-set and optional, so it is documented as PostHog's, not ours). */
  readonly postHogSessionId: string | null;
  /** PostHog's raw `distinct_id`. */
  readonly identityKey: string | null;
  readonly occurredAt: Date;
  /** PostHog's server-assigned event id (ROW 3). */
  readonly sourceEventId: string;
}

/**
 * Three rules, in order:
 *
 * 1. `postHogSessionId` present → `` `ph:${postHogSessionId}` ``.
 * 2. Else `identityKey` present →
 *    `` `gm:${identityKey}:${Math.floor(occurredAt.getTime() / SESSION_BUCKET_MS)}` ``.
 * 3. Else → `` `gm:anon:${sourceEventId}` `` — each unattributed event is its
 *    own single-event session.
 *
 * FAIL DIRECTION (F-12): never merge unattributed events into one session.
 * Merging them would fabricate a giant fake session and corrupt every
 * downstream funnel; splitting them costs a few extra rows.
 */
export function deriveSessionKey(_input: SessionKeyInput): string {
  throw new Error("TYPED STUB (O-003 scaffold): deriveSessionKey");
}
