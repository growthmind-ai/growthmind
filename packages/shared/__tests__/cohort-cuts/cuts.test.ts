import { describe, expect, test } from "bun:test";

import { BROWSER_FAMILIES, classifyBrowserFamily } from "../../src/cohort-cuts/browsers";
import {
  COHORT_CUTS,
  SURFACE_COHORT_CUT,
  browserCut,
  cohortCutsOfUserAgent,
  deviceCut,
} from "../../src/cohort-cuts/cuts";
import type { CohortCut, SessionCohortCuts } from "../../src/cohort-cuts/cuts";
import { DEVICE_TYPES, classifyDeviceType } from "../../src/cohort-cuts/devices";

const EVERY_CUT: Record<CohortCut, true> = {
  surface: true,
  "browser:safari": true,
  "browser:chrome": true,
  "browser:firefox": true,
  "browser:edge": true,
  "browser:other": true,
  "browser:unknown": true,
  "device:mobile": true,
  "device:tablet": true,
  "device:desktop": true,
  "device:unknown": true,
};

const CHROME_ON_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const SAFARI_ON_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const EDGE_ON_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.2535.51";

const OPERA_ON_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 OPR/111.0.0.0";

const KONQUEROR = "Mozilla/5.0 (compatible; Konqueror/4.5; FreeBSD) KHTML/4.5.4 (like Gecko)";

function sorted(values: readonly string[]): string[] {
  return values.toSorted((left, right) => left.localeCompare(right));
}

describe("COHORT_CUTS - one closed set derived from both taxonomies", () => {
  test("enumerates the surface sentinel, one cut per browser family and one per device type, and nothing else", () => {
    const derived = [
      SURFACE_COHORT_CUT,
      ...BROWSER_FAMILIES.map((family) => browserCut(family)),
      ...DEVICE_TYPES.map((device) => deviceCut(device)),
    ];

    expect(sorted(COHORT_CUTS)).toEqual(sorted(derived));
    expect(sorted(COHORT_CUTS)).toEqual(sorted(Object.keys(EVERY_CUT)));
    expect(COHORT_CUTS).toHaveLength(1 + BROWSER_FAMILIES.length + DEVICE_TYPES.length);
    expect(COHORT_CUTS).toHaveLength(11);
  });

  test("names every cut exactly once, so no two dimensions can collide on one label", () => {
    expect(new Set(COHORT_CUTS).size).toBe(COHORT_CUTS.length);
  });

  test("prefixes a cut with the dimension it partitions, and the sentinel with neither", () => {
    expect(SURFACE_COHORT_CUT).toBe("surface");
    expect(browserCut("chrome")).toBe("browser:chrome");
    expect(browserCut("unknown")).toBe("browser:unknown");
    expect(deviceCut("mobile")).toBe("device:mobile");
    expect(deviceCut("unknown")).toBe("device:unknown");

    for (const family of BROWSER_FAMILIES) {
      expect(COHORT_CUTS).toContain(browserCut(family));
    }
    for (const device of DEVICE_TYPES) {
      expect(COHORT_CUTS).toContain(deviceCut(device));
    }
    expect(COHORT_CUTS).toContain(SURFACE_COHORT_CUT);
  });
});

describe("cohortCutsOfUserAgent - both cuts from one user agent, in one pass", () => {
  test("an absent user agent reads as unknown on both axes", () => {
    const expected: SessionCohortCuts = { browser: "unknown", device: "unknown" };

    expect(cohortCutsOfUserAgent(null)).toEqual(expected);
    expect(cohortCutsOfUserAgent("")).toEqual(expected);
    expect(cohortCutsOfUserAgent("   ")).toEqual(expected);
  });

  test("a Chrome-on-Windows user agent reads as chrome on one axis and desktop on the other", () => {
    const expected: SessionCohortCuts = { browser: "chrome", device: "desktop" };

    expect(cohortCutsOfUserAgent(CHROME_ON_WINDOWS)).toEqual(expected);
  });

  test("agrees with both classifiers for every user agent it is given", () => {
    for (const userAgent of [
      null,
      "",
      CHROME_ON_WINDOWS,
      SAFARI_ON_IPHONE,
      EDGE_ON_WINDOWS,
      OPERA_ON_WINDOWS,
      KONQUEROR,
    ]) {
      expect(cohortCutsOfUserAgent(userAgent)).toEqual({
        browser: classifyBrowserFamily(userAgent),
        device: classifyDeviceType(userAgent),
      });
    }
  });
});
