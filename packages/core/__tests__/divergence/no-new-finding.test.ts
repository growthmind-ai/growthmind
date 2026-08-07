import { SURFACE_COHORT_CUT, browserCut } from "@growthmind/shared";
import type { CohortCut, SessionCohortCuts } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { PERCENT_SCALE } from "../../src/counts/percent";
import type { SessionTimeline } from "../../src/detect/types";
import type { DivergenceCohortCut } from "../../src/divergence/cuts";
import { cohortCutsOf } from "../../src/divergence/cuts";
import { computeDivergence } from "../../src/divergence/divergence";
import { gradeOf } from "../../src/divergence/grade";
import type { DivergenceResult } from "../../src/divergence/types";
import { DIVERGENCE_COHORT_FLOOR, DIVERGENCE_MARGIN_PERCENT } from "../../src/divergence/types";
import { sessionOf } from "../spine/fixtures";

const ORIGIN = "/pricing";
const TARGET = "/checkout";

const CHROME_DESKTOP: SessionCohortCuts = { browser: "chrome", device: "desktop" };
const SAFARI_MOBILE: SessionCohortCuts = { browser: "safari", device: "mobile" };

function cohort(
  idPrefix: string,
  count: number,
  paths: readonly string[],
  cohortCuts: SessionCohortCuts,
): readonly SessionTimeline[] {
  const sessions: SessionTimeline[] = [];
  for (let index = 0; index < count; index += 1) {
    sessions.push({ ...sessionOf(`${idPrefix}-${String(index)}`, paths), cohortCuts });
  }
  return sessions;
}

function mixedCohort(
  idPrefix: string,
  countPerFamily: number,
  paths: readonly string[],
): readonly SessionTimeline[] {
  return [
    ...cohort(`${idPrefix}-chrome`, countPerFamily, paths, CHROME_DESKTOP),
    ...cohort(`${idPrefix}-safari`, countPerFamily, paths, SAFARI_MOBILE),
  ];
}

type Fixture = {
  readonly label: string;
  readonly expectedKind: DivergenceResult["kind"];
  readonly succeeded: readonly SessionTimeline[];
  readonly failed: readonly SessionTimeline[];
};

function fixtures(): readonly Fixture[] {
  return [
    {
      label: "diverged",
      expectedKind: "diverged",
      succeeded: mixedCohort("div-succ", DIVERGENCE_COHORT_FLOOR, [ORIGIN, TARGET]),
      failed: mixedCohort("div-fail", DIVERGENCE_COHORT_FLOOR, [ORIGIN]),
    },
    {
      label: "no_divergence",
      expectedKind: "no_divergence",
      succeeded: mixedCohort("same-succ", DIVERGENCE_COHORT_FLOOR, [ORIGIN, TARGET]),
      failed: mixedCohort("same-fail", DIVERGENCE_COHORT_FLOOR, [ORIGIN, TARGET]),
    },
    {
      label: "refused",
      expectedKind: "refused",
      succeeded: cohort("thin-succ", DIVERGENCE_COHORT_FLOOR - 1, [ORIGIN, TARGET], CHROME_DESKTOP),
      failed: mixedCohort("thin-fail", DIVERGENCE_COHORT_FLOOR, [ORIGIN]),
    },
  ];
}

function cutFor(cuts: readonly DivergenceCohortCut[], id: CohortCut): DivergenceCohortCut {
  const found = cuts.find((entry) => entry.cut === id);
  if (!found) {
    throw new Error(`fixture bug: no "${id}" cut in [${cuts.map((c) => c.cut).join(", ")}]`);
  }
  return found;
}

describe("the surface-level sentence does not move when the cohort is cut (AC-5)", () => {
  test("should produce the same divergence result for the surface cut as for the undimensioned cohort", () => {
    for (const fixture of fixtures()) {
      const undimensioned = computeDivergence({
        surface: ORIGIN,
        succeeded: fixture.succeeded,
        failed: fixture.failed,
      });

      const surfaceCut = cohortCutsOf({
        succeeded: fixture.succeeded,
        failed: fixture.failed,
      })[0];
      const throughTheCut = computeDivergence({
        surface: ORIGIN,
        succeeded: surfaceCut.succeeded,
        failed: surfaceCut.failed,
      });

      expect(surfaceCut.cut).toBe(SURFACE_COHORT_CUT);
      expect(undimensioned.kind).toBe(fixture.expectedKind);
      expect(throughTheCut).toEqual(undimensioned);
    }
  });
});

describe("a bucket cannot move a surface grade (the sprint's governing invariant)", () => {
  test("should not let a diverged bucket promote a surface result or its grade", () => {
    const chromeSucceeded = cohort(
      "chrome-succ",
      DIVERGENCE_COHORT_FLOOR,
      [ORIGIN, TARGET],
      CHROME_DESKTOP,
    );
    const chromeFailed = cohort("chrome-fail", DIVERGENCE_COHORT_FLOOR, [ORIGIN], CHROME_DESKTOP);
    const safariSucceeded = cohort("safari-succ", DIVERGENCE_COHORT_FLOOR, [ORIGIN], SAFARI_MOBILE);
    const safariFailed = cohort(
      "safari-fail",
      DIVERGENCE_COHORT_FLOOR,
      [ORIGIN, TARGET],
      SAFARI_MOBILE,
    );

    const succeeded = [...chromeSucceeded, ...safariSucceeded];
    const failed = [...chromeFailed, ...safariFailed];

    const chrome = cutFor(cohortCutsOf({ succeeded, failed }), browserCut("chrome"));
    const bucketResult = computeDivergence({
      surface: ORIGIN,
      succeeded: chrome.succeeded,
      failed: chrome.failed,
    });
    const surfaceResult = computeDivergence({ surface: ORIGIN, succeeded, failed });

    // The chrome bucket's gap is every session against no session, so it clears
    // the ratified margin for any margin the constant can hold.
    expect(DIVERGENCE_MARGIN_PERCENT).toBeLessThanOrEqual(PERCENT_SCALE);
    expect(bucketResult.kind).toBe("diverged");
    expect(gradeOf(bucketResult)).toBe("explained");

    expect(surfaceResult.kind).toBe("no_divergence");
    expect(gradeOf(surfaceResult)).toBe("described");
  });
});
