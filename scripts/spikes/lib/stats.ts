import type { StatsResult, TrialRecord } from "./types";

function primaryElapsedMs(record: TrialRecord): number | undefined {
  if (record.satisfyingEndpoint !== undefined) {
    const elapsed = record.elapsedMsByEndpoint[record.satisfyingEndpoint];
    if (elapsed !== undefined) {
      return elapsed;
    }
  }
  return record.elapsedMsByEndpoint.events;
}

function percentile(sorted: readonly number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;

  return sorted[Math.max(0, idx)] as number;
}

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
