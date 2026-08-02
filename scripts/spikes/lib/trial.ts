import type { LegResult, PollEndpoint, SignalType, TrialOutcome, TrialRecord } from "./types";

const POLL_ENDPOINTS: readonly PollEndpoint[] = ["events", "query", "recordings"];

export type CaptureResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface EndpointPollOutcome {
  readonly matched: boolean;

  readonly http429: boolean;

  readonly parseFailure?: string;
}

export type PollResult = Partial<Record<PollEndpoint, EndpointPollOutcome>>;

export interface TrialConfig {
  readonly signalType: SignalType;
  readonly trials: number;
  readonly pollIntervalMs: number;
  readonly timeoutMs: number;
}

export interface TrialDeps {
  readonly capture: (marker: string) => Promise<CaptureResult>;

  readonly poll: (marker: string) => Promise<PollResult>;
  readonly sleep: (ms: number) => Promise<void>;

  readonly now: () => number;

  readonly markerFactory: () => string;

  readonly onTrialComplete: (record: TrialRecord) => Promise<void>;
}

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
    return {
      ...base,
      captureTimestamp: captureAttemptAt,
      elapsedMsByEndpoint: {},
      outcome: "errored",
      http429Count: 0,
      parseFailureCount: 0,
    };
  }

  const t0 = deps.now();
  const elapsedMsByEndpoint: Partial<Record<PollEndpoint, number>> = {};
  const reportedEndpoints = new Set<PollEndpoint>();
  let satisfyingEndpoint: PollEndpoint | undefined;
  let firstRetrievableTimestamp: number | undefined;
  let http429Count = 0;
  let parseFailureCount = 0;

  for (;;) {
    const tick = await deps.poll(marker);
    const tickNow = deps.now();

    for (const endpoint of POLL_ENDPOINTS) {
      const outcome = tick[endpoint];
      if (outcome === undefined) continue;
      reportedEndpoints.add(endpoint);
      if (outcome.http429) http429Count += 1;

      if (outcome.parseFailure !== undefined) parseFailureCount += 1;
      if (outcome.matched && elapsedMsByEndpoint[endpoint] === undefined) {
        elapsedMsByEndpoint[endpoint] = tickNow - t0;
        if (satisfyingEndpoint === undefined) {
          satisfyingEndpoint = endpoint;
          firstRetrievableTimestamp = tickNow;
        }
      }
    }

    const fullySatisfied =
      reportedEndpoints.size > 0 &&
      [...reportedEndpoints].every((endpoint) => elapsedMsByEndpoint[endpoint] !== undefined);
    if (fullySatisfied) break;

    if (tickNow - t0 >= config.timeoutMs) {
      for (const endpoint of reportedEndpoints) {
        if (elapsedMsByEndpoint[endpoint] === undefined) {
          elapsedMsByEndpoint[endpoint] = config.timeoutMs;
        }
      }
      break;
    }

    await deps.sleep(config.pollIntervalMs);
  }

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

export interface LegSpec {
  readonly signalType: SignalType;
  readonly run: () => Promise<TrialRecord[]>;
}

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
