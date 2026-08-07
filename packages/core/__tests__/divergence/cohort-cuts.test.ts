import {
  BROWSER_FAMILIES,
  COHORT_CUTS,
  DEVICE_TYPES,
  SURFACE_COHORT_CUT,
  browserCut,
  deviceCut,
} from "@growthmind/shared";
import type { BrowserFamily, CohortCut, DeviceType, SessionCohortCuts } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import type { SessionTimeline } from "../../src/detect/types";
import type { DivergenceCohortCut } from "../../src/divergence/cuts";
import { cohortCutsOf } from "../../src/divergence/cuts";
import { comparePathsAscending } from "../../src/spine/walk";
import { sessionOf } from "../spine/fixtures";

const ORIGIN = "/pricing";
const PATHS: readonly string[] = [ORIGIN, "/checkout"];

const CHROME_DESKTOP: SessionCohortCuts = { browser: "chrome", device: "desktop" };
const SAFARI_MOBILE: SessionCohortCuts = { browser: "safari", device: "mobile" };
const UNKNOWN_DESKTOP: SessionCohortCuts = { browser: "unknown", device: "desktop" };
const UNKNOWN_UNKNOWN: SessionCohortCuts = { browser: "unknown", device: "unknown" };

function withCuts(sessionId: string, cohortCuts: SessionCohortCuts): SessionTimeline {
  return { ...sessionOf(sessionId, PATHS), cohortCuts };
}

function withoutCuts(sessionId: string): SessionTimeline {
  return sessionOf(sessionId, PATHS);
}

function many(
  idPrefix: string,
  count: number,
  cohortCuts: SessionCohortCuts,
): readonly SessionTimeline[] {
  const sessions: SessionTimeline[] = [];
  for (let index = 0; index < count; index += 1) {
    sessions.push(withCuts(`${idPrefix}-${String(index)}`, cohortCuts));
  }
  return sessions;
}

function cutIds(cuts: readonly DivergenceCohortCut[]): readonly CohortCut[] {
  return cuts.map((entry) => entry.cut);
}

function cutFor(cuts: readonly DivergenceCohortCut[], id: CohortCut): DivergenceCohortCut {
  const found = cuts.find((entry) => entry.cut === id);
  if (!found) throw new Error(`fixture bug: no "${id}" cut in [${cutIds(cuts).join(", ")}]`);
  return found;
}

function idsIn(sessions: readonly SessionTimeline[]): readonly string[] {
  return sessions.map((session) => session.sessionId).toSorted(comparePathsAscending);
}

function browserCutsIn(cuts: readonly DivergenceCohortCut[]): readonly DivergenceCohortCut[] {
  const browserIds = new Set<CohortCut>(BROWSER_FAMILIES.map(browserCut));
  return cuts.filter((entry) => browserIds.has(entry.cut));
}

function deviceCutsIn(cuts: readonly DivergenceCohortCut[]): readonly DivergenceCohortCut[] {
  const deviceIds = new Set<CohortCut>(DEVICE_TYPES.map(deviceCut));
  return cuts.filter((entry) => deviceIds.has(entry.cut));
}

function totalOf(
  cuts: readonly DivergenceCohortCut[],
  side: "succeeded" | "failed",
): readonly string[] {
  return cuts
    .flatMap((entry) => entry[side].map((session) => session.sessionId))
    .toSorted(comparePathsAscending);
}

describe("cohortCutsOf — the surface cut is the caller's own cohort (Decision 4)", () => {
  test("should return the surface cut first with the caller's own arrays", () => {
    const succeeded = many("succ", 2, CHROME_DESKTOP);
    const failed = many("fail", 2, CHROME_DESKTOP);

    const result = cohortCutsOf({ succeeded, failed });

    expect(result[0].cut).toBe(SURFACE_COHORT_CUT);
    // Reference identity, not deep equality: "the surface computation is unchanged"
    // is structural only if the surface cut hands back the very arrays it was given.
    expect(result[0].succeeded).toBe(succeeded);
    expect(result[0].failed).toBe(failed);
  });
});

describe("cohortCutsOf — unknown is its own bucket, never absorbed (D5)", () => {
  test("should give sessions with no readable device its own bucket, never the majority", () => {
    const chromeSucceeded = many("succ-chrome", 3, CHROME_DESKTOP);
    const chromeFailed = many("fail-chrome", 3, CHROME_DESKTOP);
    const omitted = withoutCuts("succ-omitted");
    const declaredUnknown = withCuts("fail-declared-unknown", UNKNOWN_DESKTOP);

    const succeeded = [...chromeSucceeded, omitted];
    const failed = [...chromeFailed, declaredUnknown];

    const result = cohortCutsOf({ succeeded, failed });
    const unknown = cutFor(result, browserCut("unknown"));
    const chrome = cutFor(result, browserCut("chrome"));

    expect(idsIn(unknown.succeeded)).toEqual([omitted.sessionId]);
    expect(idsIn(unknown.failed)).toEqual([declaredUnknown.sessionId]);
    expect(idsIn(chrome.succeeded)).toEqual(idsIn(chromeSucceeded));
    expect(idsIn(chrome.failed)).toEqual(idsIn(chromeFailed));

    for (const entry of browserCutsIn(result)) {
      if (entry.cut === browserCut("unknown")) continue;
      expect(idsIn([...entry.succeeded, ...entry.failed])).not.toContain(omitted.sessionId);
      expect(idsIn([...entry.succeeded, ...entry.failed])).not.toContain(declaredUnknown.sessionId);
    }
  });

  test("should keep the unknown bucket its own bucket when unknown is the majority", () => {
    const unknownSucceeded = many("succ-unknown", 4, UNKNOWN_UNKNOWN);
    const unknownFailed = many("fail-unknown", 4, UNKNOWN_UNKNOWN);
    const chromeSucceeded = many("succ-chrome", 1, CHROME_DESKTOP);
    const chromeFailed = many("fail-chrome", 1, CHROME_DESKTOP);

    const succeeded = [...unknownSucceeded, ...chromeSucceeded];
    const failed = [...unknownFailed, ...chromeFailed];

    const result = cohortCutsOf({ succeeded, failed });
    const unknown = cutFor(result, browserCut("unknown"));
    const chrome = cutFor(result, browserCut("chrome"));

    expect(unknown.succeeded.length).toBeGreaterThan(chrome.succeeded.length);
    expect(idsIn(unknown.succeeded)).toEqual(idsIn(unknownSucceeded));
    expect(idsIn(unknown.failed)).toEqual(idsIn(unknownFailed));

    // Declaration order, not size order — a majority bucket is never renamed,
    // merged into another family, or promoted ahead of the surface cut.
    const presentBrowsers = new Set<CohortCut>([browserCut("unknown"), browserCut("chrome")]);
    const presentDevices = new Set<CohortCut>([deviceCut("unknown"), deviceCut("desktop")]);
    expect(cutIds(result)).toEqual([
      SURFACE_COHORT_CUT,
      ...BROWSER_FAMILIES.map(browserCut).filter((id) => presentBrowsers.has(id)),
      ...DEVICE_TYPES.map(deviceCut).filter((id) => presentDevices.has(id)),
    ]);
  });

  test("should treat a session timeline with no cohortCuts as unknown on both axes", () => {
    const bare = withoutCuts("succ-bare");
    const readable = withCuts("fail-readable", CHROME_DESKTOP);

    const result = cohortCutsOf({ succeeded: [bare], failed: [readable] });

    expect(idsIn(cutFor(result, browserCut("unknown")).succeeded)).toEqual([bare.sessionId]);
    expect(idsIn(cutFor(result, deviceCut("unknown")).succeeded)).toEqual([bare.sessionId]);
  });
});

describe("cohortCutsOf — a total partition of the cohort (FR-7)", () => {
  test("should partition every session exactly once per axis", () => {
    const succeeded = [
      ...many("succ-chrome", 3, CHROME_DESKTOP),
      ...many("succ-safari", 2, SAFARI_MOBILE),
      withoutCuts("succ-bare"),
    ];
    const failed = [
      ...many("fail-chrome", 2, CHROME_DESKTOP),
      ...many("fail-unknown", 2, UNKNOWN_UNKNOWN),
    ];

    const result = cohortCutsOf({ succeeded, failed });
    const surface = result[0];

    expect(totalOf(browserCutsIn(result), "succeeded")).toEqual(idsIn(surface.succeeded));
    expect(totalOf(browserCutsIn(result), "failed")).toEqual(idsIn(surface.failed));
    expect(totalOf(deviceCutsIn(result), "succeeded")).toEqual(idsIn(surface.succeeded));
    expect(totalOf(deviceCutsIn(result), "failed")).toEqual(idsIn(surface.failed));
  });

  test("should emit no cut for a bucket with no sessions", () => {
    const result = cohortCutsOf({
      succeeded: many("succ-chrome", 3, CHROME_DESKTOP),
      failed: many("fail-chrome", 3, CHROME_DESKTOP),
    });

    expect(cutIds(result)).toEqual([
      SURFACE_COHORT_CUT,
      browserCut("chrome"),
      deviceCut("desktop"),
    ]);
  });

  test("should never exceed eleven cuts", () => {
    const succeeded = BROWSER_FAMILIES.map((browser: BrowserFamily) =>
      withCuts(`succ-${browser}`, { browser, device: "desktop" }),
    );
    const failed = DEVICE_TYPES.map((device: DeviceType) =>
      withCuts(`fail-${device}`, { browser: "unknown", device }),
    );

    const result = cohortCutsOf({ succeeded, failed });

    expect(result).toHaveLength(COHORT_CUTS.length);
    for (const id of cutIds(result)) {
      expect(COHORT_CUTS).toContain(id);
    }
    expect(new Set(cutIds(result)).size).toBe(result.length);
  });
});
