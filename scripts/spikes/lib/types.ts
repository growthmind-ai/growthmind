// Discriminated unions for the spike (file 3). No `any` anywhere. These types are
// the contract: Wave 1 tests assert against them, Wave 2 implements them. Persisted
// data (RunFile) carries a host *region* string only, never keys, never the project ID
// (public-repo constraint).

/** The three measured signal legs. */
export type SignalType = "custom-event" | "exception" | "recording";

/** Read endpoints a poll tick can hit. */
export type PollEndpoint = "events" | "query" | "recordings";

/** Terminal classification of one trial. */
export type TrialOutcome = "retrieved" | "timed-out" | "errored";

/** The polling parameters a trial ran under, recorded per trial. */
export interface PollParams {
  readonly pollIntervalMs: number;
  readonly timeoutMs: number;
}

/** One trial's complete record. The unit persisted after every trial. */
export interface TrialRecord {
  readonly signalType: SignalType;
  /** 0-based index within the leg. */
  readonly trialIndex: number;
  /** The fresh-per-trial marker (multiplicity guard). */
  readonly marker: string;
  /** Epoch ms at capture success (or attempt, for errored captures). */
  readonly captureTimestamp: number;
  /** Epoch ms when any endpoint first returned the marker. Absent unless retrieved. */
  readonly firstRetrievableTimestamp?: number;
  /** Elapsed ms from capture to first match, per endpoint that matched. */
  readonly elapsedMsByEndpoint: Partial<Record<PollEndpoint, number>>;
  readonly outcome: TrialOutcome;
  readonly pollParams: PollParams;
  /** Which endpoint satisfied retrievability first. Absent unless retrieved. */
  readonly satisfyingEndpoint?: PollEndpoint;
  /** 429 responses observed while polling this trial (rate-limit note). */
  readonly http429Count: number;
  /** Poll-tick parse failures counted without aborting the loop. */
  readonly parseFailureCount: number;
  /**
   * How the recording leg produced this trial (add honesty requirement). Present only
   * on recording-leg trials, so a mixed-mode run (automated → manual fallback mid-leg)
   * is reconstructable per trial from the run file.
   */
  readonly mode?: RecordingMode;
}

/** Leg status: distinguishes "ran", "runner threw", and "excluded by flags". */
export type LegStatus = "completed" | "failed" | "not-run";

/** One leg's outcome, earlier legs' results survive a later leg's failure. */
export interface LegResult {
  readonly signalType: SignalType;
  readonly status: LegStatus;
  readonly trials: readonly TrialRecord[];
  /** Present only when status is "failed". */
  readonly failureReason?: string;
}

/** How the recording leg produced its numbers (add honesty requirement). */
export type RecordingMode = "automated" | "manual";

/** The run configuration, persisted for re-runnability. */
export interface RunConfig {
  readonly trialsPerLeg: number;
  readonly pollIntervalMs: number;
  readonly timeoutMs: number;
  readonly legs: readonly SignalType[];
  /** Present only when the recording leg ran. */
  readonly recordingMode?: RecordingMode;
}

/** Run metadata. Host region string only, never keys, never the project ID. */
export interface RunMetadata {
  /** ISO timestamp the run started. */
  readonly startedAt: string;
  /** e.g. "us" / "eu" / "self-hosted". Derived from POSTHOG_HOST, never the url's key
  /** material. */
  readonly hostRegion: string;
}

/** The one-file-per-run persistence shape. */
export interface RunFile {
  readonly metadata: RunMetadata;
  readonly config: RunConfig;
  readonly trials: readonly TrialRecord[];
}

/**
 * Parser fail direction: malformed input is a named failure, never a throw and never a
 * silent "not yet retrievable".
 */
export type ParseResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

/**
 * Stats fail direction: empty input is an explicit no-data marker, never NaN and never
 * 0. `n` counts attempted trials (timeouts included in the denominator); percentiles
 * are computed over the retrieved subset.
 */
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
