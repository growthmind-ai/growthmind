import { NOTIFICATION_WINDOW_DAYS } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import {
  DIGEST_EVALUATION_TIME_ZONE,
  digestDayMatches,
  digestWindowEnd,
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

describe("the window ends at the due day's own boundary, whatever instant the run lands", () => {
  test("every hourly run of a due day computes the same end, and the next day computes another", () => {
    expect(digestWindowEnd(MONDAY_FIRST_MS).getTime()).toBe(MONDAY_FIRST_MS.getTime());
    expect(digestWindowEnd(new Date("2026-08-10T09:30:00.000Z")).getTime()).toBe(
      MONDAY_FIRST_MS.getTime(),
    );
    expect(digestWindowEnd(MONDAY_LAST_MS).getTime()).toBe(MONDAY_FIRST_MS.getTime());

    expect(digestWindowEnd(TUESDAY_FIRST_MS).getTime()).toBe(TUESDAY_FIRST_MS.getTime());
  });
});

describe("the digest window runs from the last summary's boundary and is floored at thirty days", () => {
  const windowEnd = new Date("2026-08-10T00:00:00.000Z");
  const floor = new Date(windowEnd.getTime() - NOTIFICATION_WINDOW_DAYS * 24 * 60 * 60 * 1_000);

  test("consecutive windows tile: the next start is the last summary's boundary, not its insert instant", () => {
    // The summary row is stamped on the DB clock, after the instant its own gather ended
    // at; a window starting there would strand whatever arrived in between.
    const lastAt = new Date("2026-08-03T09:30:05.123Z");

    expect(digestWindowStart(lastAt, windowEnd).getTime()).toBe(digestWindowEnd(lastAt).getTime());
    expect(digestWindowStart(lastAt, windowEnd).getTime()).toBe(
      new Date("2026-08-03T00:00:00.000Z").getTime(),
    );
  });

  test("no summary yet floors at the bell's own window", () => {
    expect(digestWindowStart(null, windowEnd).getTime()).toBe(floor.getTime());
  });

  test("a summary older than the window floors the same way — a long-dead worker cannot emit a quarter-long digest", () => {
    const lastAt = new Date("2026-04-01T00:00:00.000Z");

    expect(digestWindowStart(lastAt, windowEnd).getTime()).toBe(floor.getTime());
  });
});
