import { describe, expect, test } from "bun:test";

import {
  LIVE_RECONNECT_MAX_MS,
  LIVE_RECONNECT_MIN_MS,
  nextBackoffMs,
} from "../../src/live/subscribe";

describe("recovering a dropped change feed", () => {
  test("waits a moment before the first retry rather than reconnecting in a tight loop", () => {
    expect(nextBackoffMs(0)).toBe(LIVE_RECONNECT_MIN_MS);
  });

  test("backs off, so a database that is down is not hammered by every web process", () => {
    expect(nextBackoffMs(LIVE_RECONNECT_MIN_MS)).toBe(LIVE_RECONNECT_MIN_MS * 2);
  });

  // Without the ceiling a feed down overnight comes back hours after the database does.
  test("stops backing off at a ceiling, so the feed always returns", () => {
    expect(nextBackoffMs(LIVE_RECONNECT_MAX_MS)).toBe(LIVE_RECONNECT_MAX_MS);
    expect(nextBackoffMs(LIVE_RECONNECT_MAX_MS * 4)).toBe(LIVE_RECONNECT_MAX_MS);
  });

  test("reaches the ceiling in a handful of retries, not a hundred", () => {
    let wait = 0;
    let retries = 0;

    while (wait < LIVE_RECONNECT_MAX_MS) {
      wait = nextBackoffMs(wait);
      retries += 1;
    }

    expect(retries).toBeLessThanOrEqual(8);
  });
});
