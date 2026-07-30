// Pure distribution stats (ADD §4 file 5).

import type { StatsResult, TrialRecord } from "./types";

/**
 * Resolves a retrieved trial's primary elapsed ms: the value stamped on its
 * satisfying endpoint, falling back to the "events" endpoint (the primary
 * retrievability leg). Returns undefined when no elapsed value is present.
 */
function primaryElapsedMs(record: TrialRecord): number | undefined {
  if (record.satisfyingEndpoint !== undefined) {
    const elapsed = record.elapsedMsByEndpoint[record.satisfyingEndpoint];
    if (elapsed !== undefined) {
      return elapsed;
    }
  }
  return record.elapsedMsByEndpoint.events;
}

/**
 * Sorted-index percentile: idx = ceil(p/100 × n) − 1 over an ascending-sorted
 * array. Caller guarantees `sorted` is non-empty.
 */
function percentile(sorted: readonly number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  // Non-empty input makes both bounds safe; clamp defensively for p = 0.
  return sorted[Math.max(0, idx)] as number;
}

/**
 * Computes p50/p90/max over the retrieved subset (percentile by sorted-index
 * method on each trial's primary elapsed ms) while reporting attempted-trial
 * counts as denominators: `n` includes timed-out and errored trials, reported
 * separately as `nTimedOut` / `nErrored`.
 *
 * Fail direction (D-5): empty input → `{ kind: "no-data" }`, never NaN/0.
 * Attempted trials with a zero-sized retrieved subset also return `no-data` —
 * percentiles over an empty subset cannot be computed without fabricating
 * values.
 */
export function computeStats(records: TrialRecord[]): StatsResult {
  if (records.length === 0) {
    return { kind: "no-data" };
  }

  let nRetrieved = 0;
  let nTimedOut = 0;
  let nErrored = 0;
  const elapsedValues: number[] = [];

  for (const record of records) {
    switch (record.outcome) {
      case "retrieved": {
        nRetrieved += 1;
        const elapsed = primaryElapsedMs(record);
        if (elapsed !== undefined) {
          elapsedValues.push(elapsed);
        }
        break;
      }
      case "timed-out":
        nTimedOut += 1;
        break;
      case "errored":
        nErrored += 1;
        break;
    }
  }

  if (elapsedValues.length === 0) {
    return { kind: "no-data" };
  }

  const sorted = elapsedValues.toSorted((a, b) => a - b);

  return {
    kind: "stats",
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    max: sorted[sorted.length - 1] as number,
    n: records.length,
    nRetrieved,
    nTimedOut,
    nErrored,
  };
}
