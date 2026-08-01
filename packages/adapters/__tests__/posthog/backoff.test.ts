// items 39–42, pure backoff. No clock, no I/O, no randomness of its own: `random` is
// injected, so both jitter branches are asserted exactly and nothing in this file
// waits.
//
// Addendum a row 5: `Retry-After` is present on a PostHog 429 and its value is bare
// delta-seconds, never an HTTP-date. It is also the only rate-limit header, so
// headroom is invisible until the limit trips.
import { describe, expect, test } from "bun:test";

import { computeBackoffDelayMs, parseRetryAfterSeconds } from "../../src/posthog/backoff";
import {
  BASE_DELAY_MS,
  JITTER_SPREAD_MS,
  MAX_BACKOFF_MS,
  RETRY_AFTER_CAP_MS,
} from "../../src/posthog/constants";

describe("parseRetryAfterSeconds", () => {
  // Item 39, row 5.
  test("parses a bare integer and rejects an HTTP-date and garbage", () => {
    expect(parseRetryAfterSeconds("59")).toBe(59);
    expect(parseRetryAfterSeconds("1")).toBe(1);

    // The HTTP-date form the rfc also allows was never observed here. Reading it as a
    // number would yield NaN or a nonsense delay, so it takes the independent
    // exponential fallback instead.
    expect(parseRetryAfterSeconds("Wed, 21 Oct 2026 07:28:00 GMT")).toBeNull();
    expect(parseRetryAfterSeconds("abc")).toBeNull();
    expect(parseRetryAfterSeconds("")).toBeNull();
    expect(parseRetryAfterSeconds(null)).toBeNull();
    expect(parseRetryAfterSeconds("-5")).toBeNull();
    expect(parseRetryAfterSeconds("1.5")).toBeNull();
  });
});

describe("computeBackoffDelayMs", () => {
  // Item 40 —.
  test("honours Retry-After up to the cap and never below the server's instruction", () => {
    // Jitter on this branch is additive-upward only: never earlier than the server
    // instructed.
    expect(computeBackoffDelayMs({ attempt: 1, retryAfterSeconds: 59, random: 0 })).toBe(59_000);
    expect(computeBackoffDelayMs({ attempt: 1, retryAfterSeconds: 59, random: 0.5 })).toBe(59_500);
    expect(
      computeBackoffDelayMs({ attempt: 4, retryAfterSeconds: 59, random: 0.5 }),
    ).toBeGreaterThanOrEqual(59_000);

    // A hostile or buggy value must never park a worker job for hours.
    const hostile = computeBackoffDelayMs({
      attempt: 1,
      retryAfterSeconds: 86_400,
      random: 0,
    });
    expect(hostile).toBe(RETRY_AFTER_CAP_MS);
    expect(
      computeBackoffDelayMs({ attempt: 1, retryAfterSeconds: 86_400, random: 0.9 }),
    ).toBeLessThanOrEqual(RETRY_AFTER_CAP_MS + JITTER_SPREAD_MS);
  });

  // Item 41 —. The fallback is retained deliberately: only one endpoint's 429 was ever
  // observed, so header uniformity is not guaranteed.
  test("falls back to capped exponential with full jitter when Retry-After is absent", () => {
    // BASE_DELAY_MS * 2^(attempt-1), then full jitter `delay *`.
    expect(computeBackoffDelayMs({ attempt: 1, retryAfterSeconds: null, random: 0 })).toBe(
      BASE_DELAY_MS * 0.5,
    );
    expect(computeBackoffDelayMs({ attempt: 3, retryAfterSeconds: null, random: 0 })).toBe(
      BASE_DELAY_MS * 4 * 0.5,
    );

    // The exponent is capped, so a long-lived run cannot compound into hours.
    const farOut = computeBackoffDelayMs({ attempt: 20, retryAfterSeconds: null, random: 0.999 });
    expect(farOut).toBeLessThanOrEqual(MAX_BACKOFF_MS);
    expect(farOut).toBeGreaterThan(MAX_BACKOFF_MS / 2);
  });

  // Item 42 —. The asymmetry between the two branches IS the point: full jitter may
  // retry early, which is fine against a limit we inferred and not fine against one the
  // server stated.
  test("jitter bounds are exact for random=0 and random=1 on both branches", () => {
    // Exponential branch, attempt 2 ⇒ raw delay 2000.
    expect(computeBackoffDelayMs({ attempt: 2, retryAfterSeconds: null, random: 0 })).toBe(1_000);
    expect(computeBackoffDelayMs({ attempt: 2, retryAfterSeconds: null, random: 1 })).toBe(2_000);

    // Retry-After branch, 10 s ⇒ never earlier than 10 s, never later than 10 s + one
    // jitter spread.
    expect(computeBackoffDelayMs({ attempt: 2, retryAfterSeconds: 10, random: 0 })).toBe(10_000);
    expect(computeBackoffDelayMs({ attempt: 2, retryAfterSeconds: 10, random: 1 })).toBe(
      10_000 + JITTER_SPREAD_MS,
    );
  });
});
