import { NOTIFICATION_WINDOW_DAYS } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import {
  DIGEST_EVALUATION_TIME_ZONE,
  digestDayMatches,
  digestWindowStart,
} from "../../src/notifications/digest";

// 2026-08-10 is a Monday. The UTC day runs [00:00:00.000Z, next 00:00:00.000Z).
const MONDAY_FIRST_MS = new Date("2026-08-10T00:00:00.000Z");
const MONDAY_LAST_MS = new Date("2026-08-10T23:59:59.999Z");
const SUNDAY_LAST_MS = new Date("2026-08-09T23:59:59.999Z");
const TUESDAY_FIRST_MS = new Date("2026-08-11T00:00:00.000Z");

describe("the digest day is decided in UTC and nowhere else", () => {
  test("the evaluation zone is the named constant, and it is UTC", () => {
    expect(DIGEST_EVALUATION_TIME_ZONE).toBe("UTC");
  });

  test("monday matches across the whole UTC day and not one millisecond outside it", () => {
    expect(digestDayMatches("monday", MONDAY_FIRST_MS)).toBe(true);
    expect(digestDayMatches("monday", MONDAY_LAST_MS)).toBe(true);

    expect(digestDayMatches("monday", SUNDAY_LAST_MS)).toBe(false);
    expect(digestDayMatches("monday", TUESDAY_FIRST_MS)).toBe(false);
  });

  test("the instant that is still Sunday afternoon in a western zone is Monday here", () => {
    // 2026-08-10T00:00:00Z is Sunday 16:00 in UTC−8; the product's answer is UTC's,
    // whatever offset the running process happens to hold.
    expect(digestDayMatches("sunday", MONDAY_FIRST_MS)).toBe(false);
    expect(digestDayMatches("tuesday", MONDAY_LAST_MS)).toBe(false);
  });
});

describe("the digest window runs from the last summary and is floored at thirty days", () => {
  const now = new Date("2026-08-10T00:00:00.000Z");
  const floor = new Date(now.getTime() - NOTIFICATION_WINDOW_DAYS * 24 * 60 * 60 * 1_000);

  test("a recent summary is the window start — a day change cannot double-report the overlap", () => {
    const lastAt = new Date("2026-08-03T00:00:00.000Z");

    expect(digestWindowStart(lastAt, now).getTime()).toBe(lastAt.getTime());
  });

  test("no summary yet floors at the bell's own window", () => {
    expect(digestWindowStart(null, now).getTime()).toBe(floor.getTime());
  });

  test("a summary older than the window floors the same way — a long-dead worker cannot emit a quarter-long digest", () => {
    const lastAt = new Date("2026-04-01T00:00:00.000Z");

    expect(digestWindowStart(lastAt, now).getTime()).toBe(floor.getTime());
  });
});
