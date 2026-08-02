export type SignalType = "custom-event" | "exception" | "recording";

export type PollEndpoint = "events" | "query" | "recordings";

export type TrialOutcome = "retrieved" | "timed-out" | "errored";

export interface PollParams {
  readonly pollIntervalMs: number;
  readonly timeoutMs: number;
}

export interface TrialRecord {
  readonly signalType: SignalType;

  readonly trialIndex: number;

  readonly marker: string;

  readonly captureTimestamp: number;

  readonly firstRetrievableTimestamp?: number;

  readonly elapsedMsByEndpoint: Partial<Record<PollEndpoint, number>>;
  readonly outcome: TrialOutcome;
  readonly pollParams: PollParams;

  readonly satisfyingEndpoint?: PollEndpoint;

  readonly http429Count: number;

  readonly parseFailureCount: number;

  readonly mode?: RecordingMode;
}

export type LegStatus = "completed" | "failed" | "not-run";

export interface LegResult {
  readonly signalType: SignalType;
  readonly status: LegStatus;
  readonly trials: readonly TrialRecord[];

  readonly failureReason?: string;
}

export type RecordingMode = "automated" | "manual";

export interface RunConfig {
  readonly trialsPerLeg: number;
  readonly pollIntervalMs: number;
  readonly timeoutMs: number;
  readonly legs: readonly SignalType[];

  readonly recordingMode?: RecordingMode;
}

export interface RunMetadata {
  readonly startedAt: string;

  readonly hostRegion: string;
}

export interface RunFile {
  readonly metadata: RunMetadata;
  readonly config: RunConfig;
  readonly trials: readonly TrialRecord[];
}

export type ParseResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

export type StatsResult =
  | {
      readonly kind: "stats";
      readonly p50: number;
      readonly p90: number;
      readonly max: number;
      readonly n: number;
      readonly nRetrieved: number;
      readonly nTimedOut: number;
      readonly nErrored: number;
    }
  | { readonly kind: "no-data" };
