// Rate-limit backoff (Addendum a row 5). Pure: no clock, no I/O, no randomness of its
// own, `random` is injected so a 429 sequence is asserted with zero wall-clock waiting.
//
// Nothing in this file calls `Date.now`, `Math.random`, or any sleep. That is what
// makes an inherently time-based loop deterministically testable.
import { BASE_DELAY_MS, JITTER_SPREAD_MS, MAX_BACKOFF_MS, RETRY_AFTER_CAP_MS } from "./constants";

export interface BackoffInput {
  /** 1-based. The exponential branch is `BASE_DELAY_MS * 2^(attempt-1)`. */
  readonly attempt: number;
  /** Parsed from the `Retry-After` header, or `null` when it was absent or unparseable. */
  readonly retryAfterSeconds: number | null;
  /** A value in `[0, 1)`. Injected, never `Math.random` at the call site. */
  readonly random: number;
}

/**
 * `Retry-After` is present on a PostHog 429 and its value is bare delta-seconds
 * , not an HTTP-date. It is also the only rate-limit header. There is no
 * `X-RateLimit-*`, so headroom is invisible until the limit trips.
 *
 * Returns `null` for an HTTP-date, a negative value, a non-integer, or anything else
 * unparseable, so the caller falls back to the independent exponential branch. That
 * fallback is retained deliberately: only one endpoint's 429 was ever observed, so
 * header uniformity is not guaranteed.
 *
 * `"0"` returns `null`, and that is a decision rather than an oversight. That decision
 * says "parseable as a positive integer" while the surrounding prose only names
 * negatives and non-integers, so zero sat between the two. Reading it as "retry
 * immediately" would mean a server that answers `Retry-After: 0` on every 429 (a
 * plausible proxy default) gets hammered in a zero-delay loop bounded only by
 * MAX_RATE_LIMIT_ATTEMPTS. Returning `null` instead falls back to the exponential
 * branch, which still retries promptly (500–1000 ms on the first attempt) but can never
 * spin. Backoff should fail toward waiting.
 */
export function parseRetryAfterSeconds(header: string | null): number | null {
  if (header === null) {
    return null;
  }
  const trimmed = header.trim();
  // Bare delta-seconds only. The rfc also permits an HTTP-date, which was never
  // observed here and which `Number` would turn into NaN or nonsense, so it takes the
  // independent exponential fallback rather than a guess.
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const seconds = Number(trimmed);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    return null;
  }
  return seconds;
}

/**
 * Two branches, with deliberately different jitter directions:
 *
 * `retryAfterSeconds` present ⇒ `min(retryAfterSeconds * 1000, RETRY_AFTER_CAP_MS)`
 *  plus additive-upward jitter `random * JITTER_SPREAD_MS`. Never earlier than the
 *  server instructed. The cap exists because a hostile or buggy value must never park
 *  a worker job for hours.
 * Absent ⇒ exponential `BASE_DELAY_MS * 2^(attempt-1)` capped at `MAX_BACKOFF_MS`, with
 *  full jitter `delay * (0.5 + 0.5 * random)`, which spreads many projects out of
 *  lockstep.
 *
 * The asymmetry is the point: full jitter can retry early, which is fine against a
 * limit we inferred but not against one the server stated.
 */
export function computeBackoffDelayMs(input: BackoffInput): number {
  const random = Math.min(Math.max(input.random, 0), 1);

  if (input.retryAfterSeconds !== null && input.retryAfterSeconds > 0) {
    const instructed = Math.min(input.retryAfterSeconds * 1000, RETRY_AFTER_CAP_MS);
    // Additive upward only. The server stated this limit, so we may wait longer than it
    // asked but never less.
    return Math.round(instructed + random * JITTER_SPREAD_MS);
  }

  // `Math.min` is applied before the multiplication so a large attempt number cannot
  // overflow to Infinity on the way to the cap.
  const attempt = Math.max(1, Math.floor(input.attempt));
  const capped = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
  // Full jitter. This limit was inferred, not stated, so retrying early is acceptable
  // and spreading many projects out of lockstep is worth more.
  return Math.round(capped * (0.5 + 0.5 * random));
}
