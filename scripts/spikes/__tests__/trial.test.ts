// Wave 1 RED tests for the effect-injected trial runner (ADD D-5) and leg
// orchestration (ADD D-6). Asserts ONLY the public contract of
// scripts/spikes/lib/trial.ts: runTrialLoop(config, deps) and runLegs(legs),
// observed through returned records and onTrialComplete calls.
// Stubs throw "not implemented" — these tests MUST fail until Wave 2.
//
// Fake-deps timing model (the contract Wave 2 implements against):
// - sleep(ms) advances the fake clock by exactly ms; nothing else moves it.
// - Trial t0 = now() at capture; first poll tick happens immediately after
//   capture success, with sleep(pollIntervalMs) BETWEEN ticks — so tick N
//   observes elapsed (N - 1) * pollIntervalMs.
// - A timed-out trial records the cap (timeoutMs) as the elapsed value for
//   each endpoint the poll reported, in elapsedMsByEndpoint.
// - After the first satisfying endpoint, polling continues for the remaining
//   endpoints until they match or the trial times out (FR-10 per-endpoint
//   elapsed).

import { describe, expect, test } from "bun:test";

import type {
  CaptureResult,
  EndpointPollOutcome,
  LegSpec,
  PollResult,
  TrialConfig,
  TrialDeps,
} from "../lib/trial";
import { runLegs, runTrialLoop } from "../lib/trial";
import type { TrialRecord } from "../lib/types";

/** One endpoint outcome with defaults; pass overrides for parse failures. */
function tickOutcome(matched: boolean, extra?: Partial<EndpointPollOutcome>): EndpointPollOutcome {
  return { matched, http429: false, ...extra };
}

/**
 * Per-marker tick-scripted poll: `script(marker, tick)` where tick is 1-based
 * and counted per marker (each trial's poll loop starts at tick 1).
 */
type PollScript = (marker: string, tick: number) => PollResult;

interface FakeWorld {
  readonly deps: TrialDeps;
  /** Records passed to onTrialComplete, in call order. */
  readonly completed: TrialRecord[];
  /** Markers passed to capture, in call order. */
  readonly captureCalls: string[];
  /** Markers passed to poll, one entry per tick, in call order. */
  readonly pollCalls: string[];
  readonly now: () => number;
}

function makeFakeWorld(options: {
  pollScript: PollScript;
  /** 1-based trial capture results; default: every capture succeeds. */
  captureScript?: (marker: string) => CaptureResult;
}): FakeWorld {
  let t = 0;
  let markerCount = 0;
  const ticksByMarker = new Map<string, number>();
  const completed: TrialRecord[] = [];
  const captureCalls: string[] = [];
  const pollCalls: string[] = [];

  const deps: TrialDeps = {
    capture: async (marker) => {
      captureCalls.push(marker);
      return options.captureScript ? options.captureScript(marker) : { ok: true };
    },
    poll: async (marker) => {
      pollCalls.push(marker);
      const tick = (ticksByMarker.get(marker) ?? 0) + 1;
      ticksByMarker.set(marker, tick);
      return options.pollScript(marker, tick);
    },
    sleep: async (ms) => {
      t += ms;
    },
    now: () => t,
    markerFactory: () => {
      markerCount += 1;
      return `marker-${markerCount}`;
    },
    onTrialComplete: async (record) => {
      completed.push(record);
    },
  };

  return { deps, completed, captureCalls, pollCalls, now: () => t };
}

function config(overrides?: Partial<TrialConfig>): TrialConfig {
  return {
    signalType: "custom-event",
    trials: 1,
    pollIntervalMs: 1000,
    timeoutMs: 120_000,
    ...overrides,
  };
}

describe("runTrialLoop", () => {
  test("should record a timed-out outcome with the cap value when the poll never matches", async () => {
    const world = makeFakeWorld({
      pollScript: () => ({
        events: tickOutcome(false),
        query: tickOutcome(false),
      }),
    });

    const records = await runTrialLoop(config({ trials: 1, timeoutMs: 120_000 }), world.deps);

    expect(records).toHaveLength(1);
    const record = records[0] as TrialRecord;
    expect(record.outcome).toBe("timed-out");
    // The cap value is recorded as elapsed for the polled endpoints.
    expect(record.elapsedMsByEndpoint.events).toBe(120_000);
    expect(record.elapsedMsByEndpoint.query).toBe(120_000);
    // Never retrieved: no satisfying endpoint, no retrievable timestamp.
    expect(record.satisfyingEndpoint).toBeUndefined();
    expect(record.firstRetrievableTimestamp).toBeUndefined();
  });

  test("should record an errored outcome when capture fails and continue to the next trial", async () => {
    const world = makeFakeWorld({
      captureScript: (marker) =>
        marker === "marker-1" ? { ok: false, reason: "capture refused" } : { ok: true },
      pollScript: () => ({ events: tickOutcome(true) }),
    });

    const records = await runTrialLoop(config({ trials: 2 }), world.deps);

    expect(records).toHaveLength(2);
    expect((records[0] as TrialRecord).outcome).toBe("errored");
    expect((records[1] as TrialRecord).outcome).toBe("retrieved");
    // The errored trial never entered a poll loop; only trial 2 polled.
    expect(world.pollCalls).not.toContain("marker-1");
    expect(world.pollCalls).toContain("marker-2");
  });

  test("should record elapsed ms per trial from capture success to first matching poll", async () => {
    // Trial 1 matches on tick 3 (elapsed 2000ms at 1000ms interval);
    // trial 2 matches on tick 5 (elapsed 4000ms). Per-trial, never averaged.
    const world = makeFakeWorld({
      pollScript: (marker, tick) => {
        const matchTick = marker === "marker-1" ? 3 : 5;
        return { events: tickOutcome(tick >= matchTick) };
      },
    });

    const records = await runTrialLoop(config({ trials: 2, pollIntervalMs: 1000 }), world.deps);

    expect(records).toHaveLength(2);
    const first = records[0] as TrialRecord;
    const second = records[1] as TrialRecord;

    expect(first.outcome).toBe("retrieved");
    expect(second.outcome).toBe("retrieved");
    expect(first.elapsedMsByEndpoint.events).toBe(2000);
    expect(second.elapsedMsByEndpoint.events).toBe(4000);

    // Elapsed is anchored on THIS trial's capture, not the run start.
    expect((first.firstRetrievableTimestamp as number) - first.captureTimestamp).toBe(2000);
    expect((second.firstRetrievableTimestamp as number) - second.captureTimestamp).toBe(4000);
  });

  test("should count poll-tick parse failures on the trial without aborting the poll loop", async () => {
    const world = makeFakeWorld({
      pollScript: (_marker, tick) => {
        if (tick <= 2) {
          return {
            events: tickOutcome(false, { parseFailure: "malformed-body" }),
          };
        }
        return { events: tickOutcome(true) };
      },
    });

    const records = await runTrialLoop(config({ trials: 1 }), world.deps);

    expect(records).toHaveLength(1);
    const record = records[0] as TrialRecord;
    // Parse failures did NOT abort the loop: tick 3 still retrieved.
    expect(record.outcome).toBe("retrieved");
    expect(record.parseFailureCount).toBe(2);
  });

  test("should generate a fresh marker per trial so no two trials share one", async () => {
    const world = makeFakeWorld({
      pollScript: () => ({ events: tickOutcome(true) }),
    });

    const records = await runTrialLoop(config({ trials: 5 }), world.deps);

    expect(records).toHaveLength(5);
    const markers = records.map((r) => r.marker);
    expect(new Set(markers).size).toBe(5);
    // Each record carries the marker the factory minted for it, in order.
    expect(markers).toEqual(["marker-1", "marker-2", "marker-3", "marker-4", "marker-5"]);
  });

  test("should call onTrialComplete after every trial including timed-out and errored ones", async () => {
    // marker-1 retrieved on tick 1; marker-2 never matches (times out at
    // 3000ms); marker-3's capture fails (errored).
    const world = makeFakeWorld({
      captureScript: (marker) =>
        marker === "marker-3" ? { ok: false, reason: "capture refused" } : { ok: true },
      pollScript: (marker) => ({
        events: tickOutcome(marker === "marker-1"),
      }),
    });

    const records = await runTrialLoop(config({ trials: 3, timeoutMs: 3000 }), world.deps);

    // One onTrialComplete call per trial, in trial order, no outcome skipped.
    expect(world.completed).toHaveLength(3);
    expect(world.completed.map((r) => r.outcome)).toEqual(["retrieved", "timed-out", "errored"]);
    expect(world.completed.map((r) => r.marker)).toEqual(["marker-1", "marker-2", "marker-3"]);
    // The same records come back from the loop itself.
    expect(records).toEqual(world.completed);
  });

  test("should record the endpoint that satisfied retrievability and both endpoints' elapsed when both were polled", async () => {
    // events matches at tick 2 (elapsed 1000ms), query at tick 4 (3000ms).
    const world = makeFakeWorld({
      pollScript: (_marker, tick) => ({
        events: tickOutcome(tick >= 2),
        query: tickOutcome(tick >= 4),
      }),
    });

    const records = await runTrialLoop(config({ trials: 1, pollIntervalMs: 1000 }), world.deps);

    expect(records).toHaveLength(1);
    const record = records[0] as TrialRecord;
    expect(record.outcome).toBe("retrieved");
    // The FIRST endpoint to return the marker satisfies retrievability.
    expect(record.satisfyingEndpoint).toBe("events");
    // Both endpoints' elapsed are carried (FR-10 endpoint comparison data).
    expect(record.elapsedMsByEndpoint.events).toBe(1000);
    expect(record.elapsedMsByEndpoint.query).toBe(3000);
    expect((record.firstRetrievableTimestamp as number) - record.captureTimestamp).toBe(1000);
  });
});

describe("runLegs", () => {
  test("should preserve completed legs' results when a later leg's runner throws", async () => {
    const legARecords: TrialRecord[] = [0, 1].map((trialIndex) => ({
      signalType: "custom-event",
      trialIndex,
      marker: `marker-${trialIndex + 1}`,
      captureTimestamp: trialIndex * 1000,
      firstRetrievableTimestamp: trialIndex * 1000 + 500,
      elapsedMsByEndpoint: { events: 500 },
      outcome: "retrieved",
      pollParams: { pollIntervalMs: 1000, timeoutMs: 120_000 },
      satisfyingEndpoint: "events",
      http429Count: 0,
      parseFailureCount: 0,
    }));

    const legs: readonly LegSpec[] = [
      { signalType: "custom-event", run: async () => legARecords },
      {
        signalType: "exception",
        run: async () => {
          throw new Error("posthog exploded");
        },
      },
    ];

    // Must not throw — a leg failure is isolated, not propagated (D8).
    const results = await runLegs(legs);

    expect(results).toHaveLength(2);

    const legA = results[0]!;
    expect(legA.signalType).toBe("custom-event");
    expect(legA.status).toBe("completed");
    expect(legA.trials).toEqual(legARecords);

    const legB = results[1]!;
    expect(legB.signalType).toBe("exception");
    expect(legB.status).toBe("failed");
    expect(legB.failureReason).toContain("posthog exploded");
    expect(legB.trials).toHaveLength(0);
  });
});
