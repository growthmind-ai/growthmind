import { describe, expect, test } from "bun:test";

import { computeStats } from "../lib/stats";
import type { StatsResult, TrialOutcome, TrialRecord } from "../lib/types";

interface MakeRecordOverrides {
  readonly outcome?: TrialOutcome;

  readonly elapsedMs?: number;
  readonly trialIndex?: number;
}

const CAPTURE_EPOCH_MS = 1_700_000_000_000;

function makeRecord(overrides: MakeRecordOverrides = {}): TrialRecord {
  const { outcome = "retrieved", elapsedMs, trialIndex = 0 } = overrides;
  const base = {
    signalType: "custom-event",
    trialIndex,
    marker: `spike-marker-${trialIndex}`,
    captureTimestamp: CAPTURE_EPOCH_MS,
    elapsedMsByEndpoint: {},
    outcome,
    pollParams: { pollIntervalMs: 500, timeoutMs: 60_000 },
    http429Count: 0,
    parseFailureCount: 0,
  } satisfies TrialRecord;

  if (outcome === "retrieved" && elapsedMs !== undefined) {
    return {
      ...base,
      elapsedMsByEndpoint: { events: elapsedMs },
      firstRetrievableTimestamp: CAPTURE_EPOCH_MS + elapsedMs,
      satisfyingEndpoint: "events",
    };
  }
  return base;
}

function retrievedRecords(elapsedValues: readonly number[]): TrialRecord[] {
  return elapsedValues.map((elapsedMs, trialIndex) =>
    makeRecord({ outcome: "retrieved", elapsedMs, trialIndex }),
  );
}

function assertStats(result: StatsResult): Extract<StatsResult, { kind: "stats" }> {
  if (result.kind !== "stats") {
    throw new Error(`expected kind "stats", got "${result.kind}"`);
  }
  return result;
}

describe("computeStats", () => {
  test("should return no-data for empty input, never NaN or zero", () => {
    const result = computeStats([]);

    expect(result.kind).toBe("no-data");

    for (const value of Object.values(result)) {
      expect(typeof value === "number" && Number.isNaN(value)).toBe(false);
      expect(value).not.toBe(0);
    }
  });

  test("should compute p50/p90/max/n for a single element", () => {
    const result = assertStats(computeStats(retrievedRecords([5000])));

    expect(result.p50).toBe(5000);
    expect(result.p90).toBe(5000);
    expect(result.max).toBe(5000);
    expect(result.n).toBe(1);
    expect(result.nRetrieved).toBe(1);
  });

  test("should compute correct percentiles for even and odd counts", () => {
    const odd = assertStats(computeStats(retrievedRecords([3000, 1000, 5000, 2000, 4000])));
    expect(odd.p50).toBe(3000);
    expect(odd.p90).toBe(5000);
    expect(odd.max).toBe(5000);
    expect(odd.n).toBe(5);

    const even = assertStats(computeStats(retrievedRecords([4000, 1000, 3000, 2000])));
    expect(even.p50).toBe(2000);
    expect(even.p90).toBe(4000);
    expect(even.max).toBe(4000);
    expect(even.n).toBe(4);
  });

  test("should handle all-equal values without division artifacts", () => {
    const elapsedValues = Array.from({ length: 10 }, () => 2000);
    const result = assertStats(computeStats(retrievedRecords(elapsedValues)));

    expect(result.p50).toBe(2000);
    expect(result.p90).toBe(2000);
    expect(result.max).toBe(2000);
    expect(result.n).toBe(10);
    expect(result.nRetrieved).toBe(10);
  });

  test("should count timed-out trials in denominators and report them separately", () => {
    const retrieved = retrievedRecords(Array.from({ length: 18 }, (_, i) => (i + 1) * 100));
    const timedOut = [
      makeRecord({ outcome: "timed-out", trialIndex: 18 }),
      makeRecord({ outcome: "timed-out", trialIndex: 19 }),
    ];

    const result = assertStats(computeStats([...retrieved, ...timedOut]));

    expect(result.n).toBe(20);
    expect(result.nTimedOut).toBe(2);
    expect(result.nRetrieved).toBe(18);
    expect(result.nErrored).toBe(0);
  });

  test("should compute stats over the retrieved subset while reporting attempted as denominator", () => {
    const retrieved = retrievedRecords(Array.from({ length: 18 }, (_, i) => (i + 1) * 100));
    const timedOut = [
      makeRecord({ outcome: "timed-out", trialIndex: 18 }),
      makeRecord({ outcome: "timed-out", trialIndex: 19 }),
    ];

    const result = assertStats(computeStats([...retrieved, ...timedOut]));

    expect(result.p50).toBe(900);
    expect(result.p90).toBe(1700);
    expect(result.max).toBe(1800);
    expect(result.n).toBe(20);
  });
});
