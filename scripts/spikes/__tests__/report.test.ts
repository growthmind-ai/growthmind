// Wave 1 red tests for the pure renderers (file 12; the plain-English bar).
// Asserts the public contract of scripts/spikes/lib/report.ts: renderVerdictLine,
// renderSummaryTable, renderDecisionDocBlock. All pure, all return string. Stubs throw
// "not implemented". These tests must fail until Wave 2. Assertions are
// substring/pattern-based: implementers keep wording freedom within the P-2 constraints
// (every count carries its denominator; "p50"/"p90" only alongside plain-English
// equivalents).

import { describe, expect, test } from "bun:test";

import { renderDecisionDocBlock, renderSummaryTable, renderVerdictLine } from "../lib/report";
import { computeStats } from "../lib/stats";
import type { LegResult, PollParams, SignalType, StatsResult, TrialRecord } from "../lib/types";

const T0 = 1_700_000_000_000;

const POLL_PARAMS: PollParams = { pollIntervalMs: 2_000, timeoutMs: 120_000 };

const NO_DATA: StatsResult = { kind: "no-data" };

function retrievedTrial(
  signalType: SignalType,
  trialIndex: number,
  elapsedMs: number,
): TrialRecord {
  return {
    signalType,
    trialIndex,
    marker: `marker-${signalType}-${trialIndex}`,
    captureTimestamp: T0 + trialIndex * 1_000,
    firstRetrievableTimestamp: T0 + trialIndex * 1_000 + elapsedMs,
    elapsedMsByEndpoint: { events: elapsedMs },
    outcome: "retrieved",
    pollParams: POLL_PARAMS,
    satisfyingEndpoint: "events",
    http429Count: 0,
    parseFailureCount: 0,
  };
}

function timedOutTrial(signalType: SignalType, trialIndex: number): TrialRecord {
  return {
    signalType,
    trialIndex,
    marker: `marker-${signalType}-${trialIndex}`,
    captureTimestamp: T0 + trialIndex * 1_000,
    elapsedMsByEndpoint: {},
    outcome: "timed-out",
    pollParams: POLL_PARAMS,
    http429Count: 0,
    parseFailureCount: 0,
  };
}

function completedLeg(signalType: SignalType, trials: readonly TrialRecord[]): LegResult {
  return { signalType, status: "completed", trials };
}

/**
 * The table/doc renderers may print latencies as raw ms or as seconds to one
 * decimal. Both satisfy "values match recomputed stats". Fixture values are
 * chosen non-round so the seconds form is distinctive.
 */
function containsMsValue(text: string, ms: number): boolean {
  return text.includes(String(ms)) || text.includes((ms / 1_000).toFixed(1));
}

describe("renderVerdictLine", () => {
  test("should render a verdict line with median, n, and worst case in plain English", () => {
    // 18 retrieved (worst 8100ms) + 2 timed out = 20 attempted, matching stats.
    const trials: TrialRecord[] = [];
    for (let i = 0; i < 17; i += 1) {
      trials.push(retrievedTrial("custom-event", i, 3_200));
    }
    trials.push(retrievedTrial("custom-event", 17, 8_100));
    trials.push(timedOutTrial("custom-event", 18));
    trials.push(timedOutTrial("custom-event", 19));

    const leg = completedLeg("custom-event", trials);
    const stats: StatsResult = {
      kind: "stats",
      p50: 3_200,
      p90: 7_000,
      max: 8_100,
      n: 20,
      nRetrieved: 18,
      nTimedOut: 2,
      nErrored: 0,
    };

    const line = renderVerdictLine(leg, stats);

    // Median in seconds form, e.g. "3.2s median".
    expect(line).toContain("3.2");
    // Worst case in seconds form.
    expect(line).toContain("8.1");
    // Denominator: the number and the word "trials" ("across 20 trials").
    expect(line).toMatch(/\b20\b/);
    expect(line).toMatch(/trials/i);
    // Jargon gate: "p50" may appear only alongside its plain-English equivalent.
    if (line.includes("p50")) {
      expect(line.toLowerCase()).toContain("median");
    }
  });

  test("should render distinct output for zero-retrieved, leg-failed, and leg-not-run", () => {
    // Completed leg where every trial timed out: 0 of 5 retrieved. With an empty
    // retrieved subset there are no percentiles, so the stats input is the no-data
    // marker. Counts must come from the leg's own records.
    const zeroRetrievedLeg = completedLeg("custom-event", [
      timedOutTrial("custom-event", 0),
      timedOutTrial("custom-event", 1),
      timedOutTrial("custom-event", 2),
      timedOutTrial("custom-event", 3),
      timedOutTrial("custom-event", 4),
    ]);
    const failedLeg: LegResult = {
      signalType: "exception",
      status: "failed",
      trials: [],
      failureReason: "leg runner threw: simulated failure",
    };
    const notRunLeg: LegResult = {
      signalType: "recording",
      status: "not-run",
      trials: [],
    };

    const zeroLine = renderVerdictLine(zeroRetrievedLeg, NO_DATA);
    const failedLine = renderVerdictLine(failedLeg, NO_DATA);
    const notRunLine = renderVerdictLine(notRunLeg, NO_DATA);

    // Pairwise different, the three states are never conflated.
    expect(zeroLine).not.toBe(failedLine);
    expect(zeroLine).not.toBe(notRunLine);
    expect(failedLine).not.toBe(notRunLine);

    // Zero-retrieved states the count with its denominator: "0 of 5".
    expect(zeroLine).toMatch(/\b0\s+of\s+5\b/);
    // Failed leg says so explicitly instead of rendering numbers.
    expect(failedLine).toMatch(/fail/i);
    // Not-run leg says it was not run.
    expect(notRunLine).toMatch(/not\s+run/i);
  });
});

describe("renderSummaryTable", () => {
  test("should render summary-table values that match recomputed stats from the same records", () => {
    // Non-round elapsed values so both ms and seconds renderings are distinctive: 1100,
    // 2300, 3600, 8100ms retrieved + 1 timed out.
    const records: TrialRecord[] = [
      retrievedTrial("custom-event", 0, 1_100),
      retrievedTrial("custom-event", 1, 2_300),
      retrievedTrial("custom-event", 2, 3_600),
      retrievedTrial("custom-event", 3, 8_100),
      timedOutTrial("custom-event", 4),
    ];
    const leg = completedLeg("custom-event", records);

    // The real consistency contract: the table's values equal the stats helper
    // recomputed from the same records. Red until both stats.ts and report.ts land.
    const stats = computeStats([...records]);
    expect(stats.kind).toBe("stats");
    if (stats.kind !== "stats") throw new Error("expected stats over retrieved records");

    const table = renderSummaryTable([leg]);

    expect(containsMsValue(table, stats.p50)).toBe(true);
    expect(containsMsValue(table, stats.p90)).toBe(true);
    expect(containsMsValue(table, stats.max)).toBe(true);
    // n counts attempted trials. Timeouts included in the denominator.
    expect(stats.n).toBe(5);
    expect(table).toMatch(/\b5\b/);
  });
});

describe("renderDecisionDocBlock", () => {
  test("should render a paste-ready results block with every count carrying its denominator", () => {
    // Leg A (custom events): 18 retrieved + 2 timed out = 20 attempted.
    const legATrials: TrialRecord[] = [];
    for (let i = 0; i < 18; i += 1) {
      legATrials.push(retrievedTrial("custom-event", i, 2_000 + i * 300));
    }
    legATrials.push(timedOutTrial("custom-event", 18));
    legATrials.push(timedOutTrial("custom-event", 19));

    // Leg B (exceptions): 10 of 10 retrieved.
    const legBTrials: TrialRecord[] = [];
    for (let i = 0; i < 10; i += 1) {
      legBTrials.push(retrievedTrial("exception", i, 1_500 + i * 400));
    }

    const block = renderDecisionDocBlock([
      completedLeg("custom-event", legATrials),
      completedLeg("exception", legBTrials),
    ]);

    // Both legs are identifiable in the block.
    expect(block).toMatch(/custom.?events?/i);
    expect(block).toMatch(/exception/i);

    // Every count carries its denominator, "X of Y" style (P-2 bar): retrieved
    // counts...
    expect(block).toMatch(/\b18\s+of\s+(?:the\s+)?20\b/);
    expect(block).toMatch(/\b10\s+of\s+(?:the\s+)?10\b/);
    // ...and the timed-out count.
    expect(block).toMatch(/\b2\s+of\s+(?:the\s+)?20\b/);

    // Jargon gate: "p90" may appear only with a plain-English explanation ("9 out of
    // 10" or similar).
    if (block.includes("p90")) {
      expect(block).toMatch(/9\s+(?:out\s+of|in)\s+(?:every\s+)?10|90\s?%|90\s+percent/i);
    }
  });
});
