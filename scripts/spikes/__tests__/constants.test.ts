// Registry-lock test for the spike constants (taxonomy. Worker task-name registry
// pattern). constants.ts is already implemented, so this suite is green from day one by
// design: it is the lock that keeps env names, event names, the marker prop, and URL
// builders from drifting or colliding, not a Wave 0 red test.

import { describe, expect, test } from "bun:test";

import {
  DEFAULT_TRIALS,
  EVENT_NAMES,
  MARKER_PROP,
  REQUIRED_ENV_VARS,
  captureUrl,
  eventsUrl,
  queryUrl,
  recordingsUrl,
} from "../lib/constants";

const HOST = "https://posthog.example.test";
const PROJECT_ID = "test-project-id";

describe("spike constants registry", () => {
  test("should export env, event, and marker constants used by both capture and poll paths", () => {
    // Exactly the four required names, no duplicates.
    expect([...REQUIRED_ENV_VARS]).toEqual([
      "POSTHOG_HOST",
      "POSTHOG_PROJECT_API_KEY",
      "POSTHOG_PERSONAL_API_KEY",
      "POSTHOG_PROJECT_ID",
    ]);
    expect(new Set(REQUIRED_ENV_VARS).size).toBe(REQUIRED_ENV_VARS.length);

    // Event names: distinct, non-empty strings.
    const eventValues = Object.values(EVENT_NAMES);
    expect(eventValues).toEqual(["gm_spike_custom_event", "$exception", "gm_spike_failed_request"]);
    for (const name of eventValues) {
      expect(typeof name).toBe("string");
      expect(name.length).toBeGreaterThan(0);
    }
    expect(new Set(eventValues).size).toBe(eventValues.length);

    // Marker prop: non-empty string.
    expect(typeof MARKER_PROP).toBe("string");
    expect(MARKER_PROP.length).toBeGreaterThan(0);
    expect(MARKER_PROP).toBe("gm_spike_marker");

    // Run default floor.
    expect(DEFAULT_TRIALS).toBeGreaterThanOrEqual(20);
  });

  test("should build capture URL containing the host input", () => {
    expect(captureUrl(HOST)).toContain(HOST);
  });

  test("should build events, query, and recordings URLs containing host and projectId", () => {
    for (const built of [
      eventsUrl(HOST, PROJECT_ID),
      queryUrl(HOST, PROJECT_ID),
      recordingsUrl(HOST, PROJECT_ID),
    ]) {
      expect(built).toContain(HOST);
      expect(built).toContain(PROJECT_ID);
    }
  });

  test("should build pairwise-distinct events/query/recordings URLs for the same inputs", () => {
    const urls = [
      eventsUrl(HOST, PROJECT_ID),
      queryUrl(HOST, PROJECT_ID),
      recordingsUrl(HOST, PROJECT_ID),
    ];
    expect(new Set(urls).size).toBe(urls.length);
  });

  test("should normalize a trailing-slash host with no double slash after the origin", () => {
    const origin = "https://x.com";
    for (const built of [
      captureUrl(`${origin}/`),
      eventsUrl(`${origin}/`, PROJECT_ID),
      queryUrl(`${origin}/`, PROJECT_ID),
      recordingsUrl(`${origin}/`, PROJECT_ID),
    ]) {
      // Strip the protocol's legitimate "//" and assert no other "//" remains.
      const afterProtocol = built.slice("https://".length);
      expect(built.startsWith(`${origin}/`)).toBe(true);
      expect(afterProtocol).not.toContain("//");
    }
  });
});
