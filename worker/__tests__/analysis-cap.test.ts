import { describe, expect, test } from "bun:test";

import * as analysisCap from "../src/analysis-cap";
import { RECORDINGS_NARRATED_PER_TICK } from "../src/analysis-cap";

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

describe("the per-tick recording cap is M-0's measurement, not a guess", () => {
  test("should not schedule more per-tick pulls than half a tick interval can serve", () => {
    expect(RECORDINGS_NARRATED_PER_TICK * measuredP90PullMs()).toBeLessThanOrEqual(
      HALF_A_TICK_INTERVAL_MS,
    );
  });

  test("should carry M-0's measured p90 wall-clock verbatim", () => {
    expect(measuredP90PullMs()).toBe(M0_MEASURED_P90_PULL_MS);
  });

  test("should cap recordings per tick at the throttle point M-0 observed, not the duty-cycle figure", () => {
    expect(RECORDINGS_NARRATED_PER_TICK).toBe(M0_OBSERVED_THROTTLE_POINT);
  });
});
