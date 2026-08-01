// Effect-injected trial runner and leg orchestration. Pure decision logic, zero direct
// I/O; every effect arrives via TrialDeps.

import type { LegResult, PollEndpoint, SignalType, TrialOutcome, TrialRecord } from "./types";

/** Iteration order for per-tick endpoint outcomes (first-matcher tie-break). */
const POLL_ENDPOINTS: readonly PollEndpoint[] = ["events", "query", "recordings"];

/** Result of one capture attempt (injected dep). */
export type CaptureResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** One endpoint's outcome within a single poll tick. */
export interface EndpointPollOutcome {
  /** True when a candidate carrying this trial's marker was returned. */
  readonly matched: boolean;
  /** True when this endpoint answered 429 this tick. */
  readonly http429: boolean;
  /** Named parse-failure reason, when the response body didn't parse. */
  readonly parseFailure?: string;
}

/** One poll tick's result across every endpoint the leg polls. */
export type PollResult = Partial<Record<PollEndpoint, EndpointPollOutcome>>;

/** Static configuration for one leg's trial loop. */
export interface TrialConfig {
  readonly signalType: SignalType;
  readonly trials: number;
  readonly pollIntervalMs: number;
  readonly timeoutMs: number;
}

/** Injected effects, fakes in tests, real fetch/clock/persist in the entrypoint. */
export interface TrialDeps {
  /** Captures one signal carrying `marker`. */
  readonly capture: (marker: string) => Promise<CaptureResult>;
  /** One poll tick, hits every relevant endpoint once. */
  readonly poll: (marker: string) => Promise<PollResult>;
  readonly sleep: (ms: number) => Promise<void>;
  /** Epoch-ms clock, a fake clock in tests. */
  readonly now: () => number;
  /** Fresh marker per trial. N trials must yield n distinct markers. */
  readonly markerFactory: () => string;
  /** Incremental persistence, called after every trial, including timed-out and
  /** errored. */
  readonly onTrialComplete: (record: TrialRecord) => Promise<void>;
}

/**
 * Runs `config.trials` sequential trials: capture → poll loop (sleep between ticks) →
 * classify `retrieved | timed-out | errored` → onTrialComplete. Capture failure →
 * `errored`, loop continues to the next trial. Poll parse failures are counted on the
 * trial without aborting its poll loop. Timeout → `timed-out` with the cap value
 * recorded as elapsed.
 */
export async function runTrialLoop(config: TrialConfig, deps: TrialDeps): Promise<TrialRecord[]> {
  const records: TrialRecord[] = [];

  for (let trialIndex = 0; trialIndex < config.trials; trialIndex += 1) {
    const marker = deps.markerFactory();
    const record = await runOneTrial(config, deps, trialIndex, marker);
    await deps.onTrialComplete(record);
    records.push(record);
  }

  return records;
}

/** Runs one capture → poll-loop → classify cycle. Pure over the injected deps. */
async function runOneTrial(
  config: TrialConfig,
  deps: TrialDeps,
  trialIndex: number,
  marker: string,
): Promise<TrialRecord> {
  const base = {
    signalType: config.signalType,
    trialIndex,
    marker,
    pollParams: {
      pollIntervalMs: config.pollIntervalMs,
      timeoutMs: config.timeoutMs,
    },
  } as const;

  const captureAttemptAt = deps.now();
  const captureResult = await deps.capture(marker);
  if (!captureResult.ok) {
    // Capture failure → errored, zero poll ticks; the loop continues.
    return {
      ...base,
      captureTimestamp: captureAttemptAt,
      elapsedMsByEndpoint: {},
      outcome: "errored",
      http429Count: 0,
      parseFailureCount: 0,
    };
  }

  // t0 anchors elapsed on this trial's capture success, not the run start.
  const t0 = deps.now();
  const elapsedMsByEndpoint: Partial<Record<PollEndpoint, number>> = {};
  const reportedEndpoints = new Set<PollEndpoint>();
  let satisfyingEndpoint: PollEndpoint | undefined;
  let firstRetrievableTimestamp: number | undefined;
  let http429Count = 0;
  let parseFailureCount = 0;

  // First tick fires immediately after capture success; sleep(pollIntervalMs) between
  // ticks. Tick N observes elapsed * pollIntervalMs.
  for (;;) {
    const tick = await deps.poll(marker);
    const tickNow = deps.now();

    for (const endpoint of POLL_ENDPOINTS) {
      const outcome = tick[endpoint];
      if (outcome === undefined) continue;
      reportedEndpoints.add(endpoint);
      if (outcome.http429) http429Count += 1;
      // Parse failures are counted on the trial; the poll loop continues.
      if (outcome.parseFailure !== undefined) parseFailureCount += 1;
      if (outcome.matched && elapsedMsByEndpoint[endpoint] === undefined) {
        elapsedMsByEndpoint[endpoint] = tickNow - t0;
        if (satisfyingEndpoint === undefined) {
          // The first endpoint to return the marker satisfies retrievability.
          satisfyingEndpoint = endpoint;
          firstRetrievableTimestamp = tickNow;
        }
      }
    }

    // Fully satisfied: every endpoint the poll has reported so far matched. After the
    // first match, remaining endpoints keep being polled.
    const fullySatisfied =
      reportedEndpoints.size > 0 &&
      [...reportedEndpoints].every((endpoint) => elapsedMsByEndpoint[endpoint] !== undefined);
    if (fullySatisfied) break;

    if (tickNow - t0 >= config.timeoutMs) {
      // Cap value (timeoutMs) recorded for each reported-but-unmatched endpoint.
      for (const endpoint of reportedEndpoints) {
        if (elapsedMsByEndpoint[endpoint] === undefined) {
          elapsedMsByEndpoint[endpoint] = config.timeoutMs;
        }
      }
      break;
    }

    await deps.sleep(config.pollIntervalMs);
  }

  // Timeout with a partial match is still "retrieved". The unmatched endpoint carries
  // the cap; only a fully unmatched trial is "timed-out".
  const outcome: TrialOutcome = satisfyingEndpoint === undefined ? "timed-out" : "retrieved";

  return {
    ...base,
    captureTimestamp: t0,
    ...(firstRetrievableTimestamp !== undefined ? { firstRetrievableTimestamp } : {}),
    elapsedMsByEndpoint,
    outcome,
    ...(satisfyingEndpoint !== undefined ? { satisfyingEndpoint } : {}),
    http429Count,
    parseFailureCount,
  };
}

/** One leg the orchestrator can run. The runner closes over its own deps. */
export interface LegSpec {
  readonly signalType: SignalType;
  readonly run: () => Promise<TrialRecord[]>;
}

/**
 * Runs legs sequentially, each in its own try/catch. A throwing runner yields `{
 * status: "failed", failureReason }` for that leg while every earlier leg's completed
 * `LegResult` is preserved and later legs still run (— leg isolation).
 */
export async function runLegs(legs: readonly LegSpec[]): Promise<LegResult[]> {
  const results: LegResult[] = [];

  for (const leg of legs) {
    try {
      const trials = await leg.run();
      results.push({ signalType: leg.signalType, status: "completed", trials });
    } catch (error) {
      results.push({
        signalType: leg.signalType,
        status: "failed",
        trials: [],
        failureReason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}
