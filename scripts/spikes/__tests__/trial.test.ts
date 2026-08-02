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

function tickOutcome(matched: boolean, extra?: Partial<EndpointPollOutcome>): EndpointPollOutcome {
  return { matched, http429: false, ...extra };
}

type PollScript = (marker: string, tick: number) => PollResult;

interface FakeWorld {
  readonly deps: TrialDeps;

  readonly completed: TrialRecord[];

  readonly captureCalls: string[];

  readonly pollCalls: string[];
  readonly now: () => number;
}

function makeFakeWorld(options: {
  pollScript: PollScript;

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

    expect(record.elapsedMsByEndpoint.events).toBe(120_000);
    expect(record.elapsedMsByEndpoint.query).toBe(120_000);

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

    expect(world.pollCalls).not.toContain("marker-1");
    expect(world.pollCalls).toContain("marker-2");
  });

  test("should record elapsed ms per trial from capture success to first matching poll", async () => {
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

    expect(markers).toEqual(["marker-1", "marker-2", "marker-3", "marker-4", "marker-5"]);
  });

  test("should call onTrialComplete after every trial including timed-out and errored ones", async () => {
    const world = makeFakeWorld({
      captureScript: (marker) =>
        marker === "marker-3" ? { ok: false, reason: "capture refused" } : { ok: true },
      pollScript: (marker) => ({
        events: tickOutcome(marker === "marker-1"),
      }),
    });

    const records = await runTrialLoop(config({ trials: 3, timeoutMs: 3000 }), world.deps);

    expect(world.completed).toHaveLength(3);
    expect(world.completed.map((r) => r.outcome)).toEqual(["retrieved", "timed-out", "errored"]);
    expect(world.completed.map((r) => r.marker)).toEqual(["marker-1", "marker-2", "marker-3"]);

    expect(records).toEqual(world.completed);
  });

  test("should record the endpoint that satisfied retrievability and both endpoints' elapsed when both were polled", async () => {
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

    expect(record.satisfyingEndpoint).toBe("events");

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
