import { describe, expect, it } from "bun:test";

import {
  deriveConstants,
  distributionOf,
  FR02_TABLE_ROWS,
  FR02_THRESHOLDS,
  MIB,
  nextPowerOfTwo,
  percentile,
  selectBranch,
  summarise,
  type RecordingPullRecord,
} from "../lib/m0-pull";

const record = (over: Partial<RecordingPullRecord>): RecordingPullRecord => ({
  recordingId: "rec",
  outcome: "pulled",
  bytes: 0,
  declaredBytes: 0,
  largestResponseBytes: 0,
  responses: 1,
  wallClockMs: 0,
  eventCount: 0,
  actionCount: 0,
  transcriptMs: 0,
  stop: "exhausted",
  droppedMalformed: 0,
  reason: null,
  ...over,
});

describe("the frozen FR-0.2 thresholds", () => {
  // AC-0.5 fails the sprint on a diff to these numbers. This is the assertion that makes
  // "byte-identical" machine-checked rather than eyeballed.
  it("holds 5 MB, 25 MB, 10 s, 30 s and a 50% join floor, unamended", () => {
    expect(FR02_THRESHOLDS.shipBytes).toBe(5 * 1024 * 1024);
    expect(FR02_THRESHOLDS.stopBytes).toBe(25 * 1024 * 1024);
    expect(FR02_THRESHOLDS.shipMs).toBe(10_000);
    expect(FR02_THRESHOLDS.stopMs).toBe(30_000);
    expect(FR02_THRESHOLDS.overlapFloor).toBe(0.5);
  });

  it("prints all four rows of the table a reader has to check the branch against", () => {
    expect(FR02_TABLE_ROWS).toHaveLength(4);
    expect(FR02_TABLE_ROWS.join("\n")).toContain("Ship as specified");
    expect(FR02_TABLE_ROWS.join("\n")).toContain("STOP on the join premise");
  });
});

describe("selectBranch", () => {
  const overlap = 0.579;

  it("ships as specified at exactly 5 MB and exactly 10 s", () => {
    const decision = selectBranch({
      p90Bytes: FR02_THRESHOLDS.shipBytes,
      p90Ms: FR02_THRESHOLDS.shipMs,
      overlap,
    });
    expect(decision.branch).toBe("ship_as_specified");
    expect(decision.stops).toBe(false);
  });

  it("requires the mandatory bound one byte over 5 MB", () => {
    expect(
      selectBranch({ p90Bytes: FR02_THRESHOLDS.shipBytes + 1, p90Ms: 1_000, overlap }).branch,
    ).toBe("ship_with_mandatory_bound");
  });

  it("requires the mandatory bound one millisecond over 10 s", () => {
    expect(
      selectBranch({ p90Bytes: 1_000, p90Ms: FR02_THRESHOLDS.shipMs + 1, overlap }).branch,
    ).toBe("ship_with_mandatory_bound");
  });

  it("still ships with the bound at exactly 25 MB and exactly 30 s", () => {
    const decision = selectBranch({
      p90Bytes: FR02_THRESHOLDS.stopBytes,
      p90Ms: FR02_THRESHOLDS.stopMs,
      overlap,
    });
    expect(decision.branch).toBe("ship_with_mandatory_bound");
    expect(decision.stops).toBe(false);
  });

  it("stops one byte over 25 MB", () => {
    const decision = selectBranch({
      p90Bytes: FR02_THRESHOLDS.stopBytes + 1,
      p90Ms: 1_000,
      overlap,
    });
    expect(decision.branch).toBe("stop_on_numbers");
    expect(decision.stops).toBe(true);
  });

  it("stops one millisecond over 30 s", () => {
    expect(
      selectBranch({ p90Bytes: 1_000, p90Ms: FR02_THRESHOLDS.stopMs + 1, overlap }).stops,
    ).toBe(true);
  });

  it("stops on the join premise when overlap falls under 50%, however good the numbers are", () => {
    const decision = selectBranch({ p90Bytes: 1_000, p90Ms: 100, overlap: 0.499 });
    expect(decision.branch).toBe("stop_on_join");
    expect(decision.reasons.join(" ")).toContain("49.9%");
  });

  it("clears the join floor at exactly 50%", () => {
    expect(selectBranch({ p90Bytes: 1_000, p90Ms: 100, overlap: 0.5 }).branch).toBe(
      "ship_as_specified",
    );
  });

  it("names both stops when the numbers and the join both fail", () => {
    const decision = selectBranch({
      p90Bytes: FR02_THRESHOLDS.stopBytes + 1,
      p90Ms: FR02_THRESHOLDS.stopMs + 1,
      overlap: 0.1,
    });
    expect(decision.branch).toBe("stop_on_numbers");
    expect(decision.reasons).toHaveLength(3);
  });
});

describe("nextPowerOfTwo", () => {
  it("returns the value itself when it is already a power of two", () => {
    expect(nextPowerOfTwo(4 * MIB)).toBe(4 * MIB);
  });

  it("rounds up to the next power of two", () => {
    expect(nextPowerOfTwo(3 * MIB)).toBe(4 * MIB);
    expect(nextPowerOfTwo(1)).toBe(1);
    expect(nextPowerOfTwo(1_025)).toBe(2_048);
  });

  it("returns 1 for zero, negatives and non-finite input rather than looping", () => {
    expect(nextPowerOfTwo(0)).toBe(1);
    expect(nextPowerOfTwo(-5)).toBe(1);
    expect(nextPowerOfTwo(Number.NaN)).toBe(1);
  });
});

describe("deriveConstants", () => {
  it("sets MAX_PULL_BYTES from the p90 rounded up to the next power of two", () => {
    expect(deriveConstants(3 * MIB, 5_000).maxPullBytes).toBe(4 * MIB);
  });

  it("carries the p90 wall-clock through verbatim", () => {
    expect(deriveConstants(1, 4_321).measuredP90PullMs).toBe(4_321);
  });

  it("keeps the per-tick cap at 25 when the duty-cycle arithmetic allows more", () => {
    expect(deriveConstants(1, 10_000).recordingsNarratedPerTick).toBe(25);
  });

  it("reduces the per-tick cap once a recording costs more than a 25-recording tick allows", () => {
    expect(deriveConstants(1, 13_000).recordingsNarratedPerTick).toBe(23);
    expect(deriveConstants(1, 30_000).recordingsNarratedPerTick).toBe(10);
  });

  it("keeps the arithmetic the ADD asserts: cap x p90 stays inside half a tick", () => {
    for (const p90Ms of [1_000, 9_999, 12_500, 20_000, 30_000]) {
      const derived = deriveConstants(1, p90Ms);
      expect(derived.recordingsNarratedPerTick * p90Ms).toBeLessThanOrEqual(300_000);
    }
  });

  it("falls back to the current cap rather than infinity when the p90 is zero", () => {
    expect(deriveConstants(1, 0).recordingsNarratedPerTick).toBe(25);
  });
});

describe("percentile and distribution", () => {
  it("returns an observed value by nearest rank, never an interpolated one", () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(sorted, 50)).toBe(5);
    expect(percentile(sorted, 90)).toBe(9);
  });

  it("handles a single value without walking off either end", () => {
    expect(percentile([7], 50)).toBe(7);
    expect(percentile([7], 90)).toBe(7);
  });

  it("returns null for no values rather than a zero that reads as a measurement", () => {
    expect(distributionOf([])).toBeNull();
  });
});

describe("summarise", () => {
  // The whole point of FR-0.1b: a slow recording biases the number it is meant to produce,
  // so a timeout is a row in the distribution, not an exclusion from it.
  it("counts timed-out and errored recordings in n and in the distributions", () => {
    const summary = summarise([
      record({ bytes: 1_000, wallClockMs: 500 }),
      record({ outcome: "timeout", bytes: 9_000, wallClockMs: 60_000, stop: null }),
      record({ outcome: "errored", bytes: 0, wallClockMs: 120, stop: null }),
      record({ outcome: "partial", bytes: 5_000, wallClockMs: 4_000, stop: null }),
    ]);

    expect(summary?.n).toBe(4);
    expect(summary?.nPulled).toBe(1);
    expect(summary?.nTimedOut).toBe(1);
    expect(summary?.nErrored).toBe(1);
    expect(summary?.nPartial).toBe(1);
    expect(summary?.bytes.max).toBe(9_000);
    expect(summary?.wallClock.max).toBe(60_000);
    expect(summary?.totalBytes).toBe(15_000);
  });

  it("returns null when nothing was attempted", () => {
    expect(summarise([])).toBeNull();
  });
});
