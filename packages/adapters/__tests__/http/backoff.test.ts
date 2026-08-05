import { describe, expect, test } from "bun:test";

import { computeBackoffDelayMs, parseRetryAfterSeconds } from "../../src/http/backoff";
import {
  BASE_DELAY_MS,
  JITTER_SPREAD_MS,
  MAX_BACKOFF_MS,
  RETRY_AFTER_CAP_MS,
} from "../../src/http/constants";

describe("parseRetryAfterSeconds", () => {
  test("parses a bare integer and rejects an HTTP-date and garbage", () => {
    expect(parseRetryAfterSeconds("59")).toBe(59);
    expect(parseRetryAfterSeconds("1")).toBe(1);

    expect(parseRetryAfterSeconds("Wed, 21 Oct 2026 07:28:00 GMT")).toBeNull();
    expect(parseRetryAfterSeconds("abc")).toBeNull();
    expect(parseRetryAfterSeconds("")).toBeNull();
    expect(parseRetryAfterSeconds(null)).toBeNull();
    expect(parseRetryAfterSeconds("-5")).toBeNull();
    expect(parseRetryAfterSeconds("1.5")).toBeNull();
  });
});

describe("computeBackoffDelayMs", () => {
  test("honours Retry-After up to the cap and never below the server's instruction", () => {
    expect(computeBackoffDelayMs({ attempt: 1, retryAfterSeconds: 59, random: 0 })).toBe(59_000);
    expect(computeBackoffDelayMs({ attempt: 1, retryAfterSeconds: 59, random: 0.5 })).toBe(59_500);
    expect(
      computeBackoffDelayMs({ attempt: 4, retryAfterSeconds: 59, random: 0.5 }),
    ).toBeGreaterThanOrEqual(59_000);

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

  test("falls back to capped exponential with full jitter when Retry-After is absent", () => {
    expect(computeBackoffDelayMs({ attempt: 1, retryAfterSeconds: null, random: 0 })).toBe(
      BASE_DELAY_MS * 0.5,
    );
    expect(computeBackoffDelayMs({ attempt: 3, retryAfterSeconds: null, random: 0 })).toBe(
      BASE_DELAY_MS * 4 * 0.5,
    );

    const farOut = computeBackoffDelayMs({ attempt: 20, retryAfterSeconds: null, random: 0.999 });
    expect(farOut).toBeLessThanOrEqual(MAX_BACKOFF_MS);
    expect(farOut).toBeGreaterThan(MAX_BACKOFF_MS / 2);
  });

  test("jitter bounds are exact for random=0 and random=1 on both branches", () => {
    expect(computeBackoffDelayMs({ attempt: 2, retryAfterSeconds: null, random: 0 })).toBe(1_000);
    expect(computeBackoffDelayMs({ attempt: 2, retryAfterSeconds: null, random: 1 })).toBe(2_000);

    expect(computeBackoffDelayMs({ attempt: 2, retryAfterSeconds: 10, random: 0 })).toBe(10_000);
    expect(computeBackoffDelayMs({ attempt: 2, retryAfterSeconds: 10, random: 1 })).toBe(
      10_000 + JITTER_SPREAD_MS,
    );
  });
});
