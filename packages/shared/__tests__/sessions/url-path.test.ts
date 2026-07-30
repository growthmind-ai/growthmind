// ADD §9 item 26 — URL-path normalisation (O-003 SEC-B, edge taxonomy D12).
//
// Addendum A SEC-B pinned that `$current_url` carries the FULL url including
// the query string, while `$pathname` is the path alone. Storing the raw
// `$current_url` would mean one UTM parameter forks the surface and every
// finding signature hanging off it — a textbook identity churn, paid for by an
// ordinary campaign link.
import { describe, expect, test } from "bun:test";

import { URL_PATH_NORMALISATION_VERSION, normaliseUrlPath } from "../../src/sessions/url-path";

const CAMPAIGN_URL = "https://probe.example.invalid/app/step/11?utm_source=probe&q=11";
const OTHER_CAMPAIGN_URL = "https://probe.example.invalid/app/step/11?utm_source=newsletter";

describe("normaliseUrlPath", () => {
  // Item 26
  test("strips the query string and fragment so a UTM parameter cannot fork the surface", () => {
    // Two visits to the same page from two campaigns are ONE surface.
    expect(normaliseUrlPath(null, CAMPAIGN_URL)).toBe("/app/step/11");
    expect(normaliseUrlPath(null, OTHER_CAMPAIGN_URL)).toBe("/app/step/11");
    expect(normaliseUrlPath(null, CAMPAIGN_URL)).toBe(normaliseUrlPath(null, OTHER_CAMPAIGN_URL));

    // The fragment is a client-side anchor, never a distinct surface.
    expect(normaliseUrlPath(null, "https://probe.example.invalid/pricing#faq")).toBe("/pricing");
    expect(normaliseUrlPath(null, "https://probe.example.invalid/pricing?ref=x#faq")).toBe(
      "/pricing",
    );

    // And the same page reached with and without a campaign is one value.
    expect(normaliseUrlPath("/app/step/11", CAMPAIGN_URL)).toBe(
      normaliseUrlPath("/app/step/11", null),
    );
  });

  test("prefers $pathname and falls back to the path parsed out of $current_url", () => {
    // SEC-B's stated degradation: $pathname when the SDK sent it, otherwise
    // the path parsed out of the full url.
    expect(normaliseUrlPath("/app/step/11", CAMPAIGN_URL)).toBe("/app/step/11");
    expect(normaliseUrlPath(null, CAMPAIGN_URL)).toBe("/app/step/11");
    expect(normaliseUrlPath("/checkout", null)).toBe("/checkout");
  });

  test("the host is not part of the value, so one path is one surface across environments", () => {
    expect(normaliseUrlPath(null, "https://probe.example.invalid/pricing")).toBe("/pricing");
    expect(normaliseUrlPath(null, "https://other.example.invalid/pricing")).toBe("/pricing");
  });

  test("lowercases and removes a trailing slash, except on the root path", () => {
    expect(normaliseUrlPath("/App/Step", null)).toBe("/app/step");
    expect(normaliseUrlPath("/pricing/", null)).toBe("/pricing");
    expect(normaliseUrlPath("/", null)).toBe("/");
    expect(normaliseUrlPath(null, "https://probe.example.invalid/")).toBe("/");
    expect(normaliseUrlPath(null, "https://probe.example.invalid")).toBe("/");
  });

  test("returns null when neither input yields a usable path — an absent path is not an error", () => {
    // The column is nullable; SEC-A/SEC-B properties are SDK-set and optional,
    // and a server-side integration sends neither.
    expect(normaliseUrlPath(null, null)).toBeNull();
    expect(normaliseUrlPath("", "")).toBeNull();
    expect(normaliseUrlPath("", null)).toBeNull();
    expect(normaliseUrlPath(null, "not-a-url")).toBeNull();
  });

  test("the normalisation rules are versioned", () => {
    // A rule change must be a detectable, migratable event rather than a
    // silent fork of every stored path.
    expect(URL_PATH_NORMALISATION_VERSION).toBe(1);
  });
});
