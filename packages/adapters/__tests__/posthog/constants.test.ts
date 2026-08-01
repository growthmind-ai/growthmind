// item 62, the assumed-ceiling guard, plus the two url builders.
//
// Addendum a row 1 pins `limit` as honoured to at least 220 rows in a single response;
// a ceiling above 220 was not testable against the probe project. So 220 is a proven
// floor, not a proven ceiling, and PAGE_LIMIT must sit under it. This test is what
// stops someone "optimising" the page size past a number nobody has measured.
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
  // Supports item 62: the endpoint paths are themselves a pinned external contract (row
  // 1 / row 6), and a trailing slash on the customer's host must never produce a double
  // slash the server would treat as a different path.
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

  // Security audit. `sourceProjectId` is customer-supplied and was interpolated
  // into the url path unescaped. A value containing "/" could redirect the request to a
  // different path on the same (already host-guard-validated) origin. Fail direction:
  // encode on doubt, so a path-shaped value can never widen into a path other than the
  // customer's own project's.
  test("percent-encodes a sourceProjectId that would otherwise inject extra path segments", () => {
    const hostile = "424242/../../admin";
    expect(eventsUrl(AD_HOST, hostile)).toBe(
      `${AD_HOST}/api/projects/${encodeURIComponent(hostile)}/events`,
    );
    // The encoded form carries no literal "/". The hostile value collapses to one
    // opaque path segment rather than escaping it.
    expect(eventsUrl(AD_HOST, hostile)).not.toContain("/../");
    expect(personsUrl(AD_HOST, hostile)).toBe(
      `${AD_HOST}/api/projects/${encodeURIComponent(hostile)}/persons`,
    );
  });

  // Near miss: an ordinary numeric project id (the real-world shape) is encoded to
  // itself. Encoding must not visibly change the common case.
  test("near miss: an ordinary numeric sourceProjectId is unchanged by encoding", () => {
    expect(eventsUrl(AD_HOST, AD_SOURCE_PROJECT_ID)).toBe(
      `${AD_HOST}/api/projects/${AD_SOURCE_PROJECT_ID}/events`,
    );
  });
});
