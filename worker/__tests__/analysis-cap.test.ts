import { describe, expect, test } from "bun:test";

import * as analysisCap from "../src/analysis-cap";
import {
  RECORDINGS_NARRATED_PER_LANE,
  RECORDINGS_PULLED_PER_TICK_CEILING,
} from "../src/analysis-cap";

const HALF_A_TICK_INTERVAL_MS = 300_000;

const M0_MEASURED_P90_PULL_MS = 2_046;

const M0_OBSERVED_THROTTLE_POINT = 12;

function measuredP90PullMs(): number {
  const declared = (analysisCap as unknown as Record<string, unknown>).MEASURED_P90_PULL_MS;

  if (typeof declared !== "number") {
    throw new Error(
      "worker/src/analysis-cap.ts declares no MEASURED_P90_PULL_MS. ADD §7 requires M-0's " +
        "complete-pull p90 wall-clock to live in the type system rather than in a PR comment.",
    );
  }

  return declared;
}

describe("the per-lane recording cap is M-0's measurement, not a guess", () => {
  test("should not schedule more per-lane pulls than half a tick interval can serve", () => {
    expect(RECORDINGS_NARRATED_PER_LANE * measuredP90PullMs()).toBeLessThanOrEqual(
      HALF_A_TICK_INTERVAL_MS,
    );
  });

  test("should carry M-0's measured p90 wall-clock verbatim", () => {
    expect(measuredP90PullMs()).toBe(M0_MEASURED_P90_PULL_MS);
  });

  test("should cap recordings per lane at the throttle point M-0 observed, not the duty-cycle figure", () => {
    expect(RECORDINGS_NARRATED_PER_LANE).toBe(M0_OBSERVED_THROTTLE_POINT);
  });
});

describe("the per-tick ceiling bounds the whole tick, which the per-lane cap cannot", () => {
  test("should not schedule more pulls across every lane than half a tick interval can serve", () => {
    expect(RECORDINGS_PULLED_PER_TICK_CEILING * measuredP90PullMs()).toBeLessThanOrEqual(
      HALF_A_TICK_INTERVAL_MS,
    );
  });

  test("should sit above the per-lane cap, so one lane is never truncated by the ceiling", () => {
    expect(RECORDINGS_PULLED_PER_TICK_CEILING).toBeGreaterThan(RECORDINGS_NARRATED_PER_LANE);
  });

  test("should be the duty-cycle figure, so the ceiling moves when the measurement does", () => {
    expect(RECORDINGS_PULLED_PER_TICK_CEILING).toBe(
      Math.floor(HALF_A_TICK_INTERVAL_MS / M0_MEASURED_P90_PULL_MS),
    );
  });
});
