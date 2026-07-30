// ADD §9 item 62 — the ASSUMED-ceiling guard, plus the two url builders.
//
// Addendum A ROW 1 pins `limit` as honoured to at least 220 rows in a single
// response; a ceiling ABOVE 220 was not testable against the probe project. So
// 220 is a proven FLOOR, not a proven ceiling, and PAGE_LIMIT must sit under
// it. This test is what stops someone "optimising" the page size past a number
// nobody has measured.
import { describe, expect, test } from "bun:test";

import {
  PAGE_LIMIT,
  PINNED_PAGE_LIMIT_FLOOR,
  POSTHOG_SOURCE_KIND,
  eventsUrl,
  personsUrl,
} from "../../src/posthog/constants";
import { AD_HOST, AD_SOURCE_PROJECT_ID } from "../helpers/fakes";

describe("tuning constants", () => {
  // Item 62.
  test("PAGE_LIMIT is at or below the pinned 220-row floor", () => {
    expect(PINNED_PAGE_LIMIT_FLOOR).toBe(220);
    expect(PAGE_LIMIT).toBeLessThanOrEqual(PINNED_PAGE_LIMIT_FLOOR);
    expect(PAGE_LIMIT).toBeGreaterThan(0);
  });
});

describe("url builders", () => {
  // Supports item 62: the endpoint paths are themselves a pinned external
  // contract (ROW 1 / ROW 6), and a trailing slash on the customer's host must
  // never produce a double slash the server would treat as a different path.
  test("build the pinned events and persons paths and trim a trailing host slash", () => {
    expect(eventsUrl(AD_HOST, AD_SOURCE_PROJECT_ID)).toBe(
      `${AD_HOST}/api/projects/${AD_SOURCE_PROJECT_ID}/events`,
    );
    expect(personsUrl(AD_HOST, AD_SOURCE_PROJECT_ID)).toBe(
      `${AD_HOST}/api/projects/${AD_SOURCE_PROJECT_ID}/persons`,
    );

    expect(eventsUrl(`${AD_HOST}/`, AD_SOURCE_PROJECT_ID)).toBe(
      `${AD_HOST}/api/projects/${AD_SOURCE_PROJECT_ID}/events`,
    );
    expect(personsUrl(`${AD_HOST}///`, AD_SOURCE_PROJECT_ID)).toBe(
      `${AD_HOST}/api/projects/${AD_SOURCE_PROJECT_ID}/persons`,
    );
  });

  test("POSTHOG_SOURCE_KIND is the one member of the shared kind union", () => {
    expect(POSTHOG_SOURCE_KIND).toBe("posthog");
  });
});
