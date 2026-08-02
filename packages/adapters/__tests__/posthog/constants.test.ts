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
  test("PAGE_LIMIT is at or below the pinned 220-row floor", () => {
    expect(PINNED_PAGE_LIMIT_FLOOR).toBe(220);
    expect(PAGE_LIMIT).toBeLessThanOrEqual(PINNED_PAGE_LIMIT_FLOOR);
    expect(PAGE_LIMIT).toBeGreaterThan(0);
  });
});

describe("url builders", () => {
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

  test("percent-encodes a sourceProjectId that would otherwise inject extra path segments", () => {
    const hostile = "424242/../../admin";
    expect(eventsUrl(AD_HOST, hostile)).toBe(
      `${AD_HOST}/api/projects/${encodeURIComponent(hostile)}/events`,
    );

    expect(eventsUrl(AD_HOST, hostile)).not.toContain("/../");
    expect(personsUrl(AD_HOST, hostile)).toBe(
      `${AD_HOST}/api/projects/${encodeURIComponent(hostile)}/persons`,
    );
  });

  test("near miss: an ordinary numeric sourceProjectId is unchanged by encoding", () => {
    expect(eventsUrl(AD_HOST, AD_SOURCE_PROJECT_ID)).toBe(
      `${AD_HOST}/api/projects/${AD_SOURCE_PROJECT_ID}/events`,
    );
  });
});
