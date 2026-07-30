// Rate-limit backoff (O-003 D-8, Addendum A ROW 5). Pure: no clock, no I/O,
// no randomness of its own — `random` is injected so a 429 sequence is
// asserted with zero wall-clock waiting.
//
// TYPED STUB (O-003 scaffold): the signatures are final; the bodies throw.

export interface BackoffInput {
  /** 1-based. The exponential branch is `BASE_DELAY_MS * 2^(attempt-1)`. */
  readonly attempt: number;
  /** Parsed from the `Retry-After` header, or `null` when it was absent or
   * unparseable. */
  readonly retryAfterSeconds: number | null;
  /** A value in `[0, 1)`. Injected, never `Math.random()` at the call site. */
  readonly random: number;
}

/**
 * `Retry-After` is present on a PostHog 429 and its value is BARE
 * DELTA-SECONDS (`"59"`), not an HTTP-date. It is also the ONLY rate-limit
 * header — there is no `X-RateLimit-*`, so headroom is invisible until the
 * limit trips.
 *
 * Returns `null` for an HTTP-date, a negative value, a non-integer, or
 * anything else unparseable, so the caller falls back to the independent
 * exponential branch. That fallback is retained deliberately: only one
 * endpoint's 429 was ever observed, so header uniformity is not guaranteed.
 */
export function parseRetryAfterSeconds(_header: string | null): number | null {
  throw new Error("TYPED STUB (O-003 scaffold): parseRetryAfterSeconds");
}

/**
 * Two branches, with DELIBERATELY DIFFERENT jitter directions:
 *
 * - `retryAfterSeconds` present ⇒
 *   `min(retryAfterSeconds * 1000, RETRY_AFTER_CAP_MS)` plus ADDITIVE-UPWARD
 *   jitter `random * JITTER_SPREAD_MS`. Never earlier than the server
 *   instructed. The cap exists because a hostile or buggy value must never
 *   park a worker job for hours.
 * - absent ⇒ exponential `BASE_DELAY_MS * 2^(attempt-1)` capped at
 *   `MAX_BACKOFF_MS`, with FULL jitter `delay * (0.5 + 0.5 * random)`, which
 *   spreads many projects out of lockstep.
 *
 * The asymmetry is the point: full jitter can retry early, which is fine
 * against a limit we inferred but not against one the server stated.
 */
export function computeBackoffDelayMs(_input: BackoffInput): number {
  throw new Error("TYPED STUB (O-003 scaffold): computeBackoffDelayMs");
}
