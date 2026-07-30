// Discriminated unions for the M-0 spike (ADD §4 file 3). No `any` anywhere.
// These types ARE the contract: Wave 1 tests assert against them, Wave 2
// implements them. Persisted data (RunFile) carries a host *region* string
// only — never keys, never the project ID (public-repo constraint).

/** The three measured signal legs. */
export type SignalType = "custom-event" | "exception" | "recording";

/** Read endpoints a poll tick can hit (ADD D-3). */
export type PollEndpoint = "events" | "query" | "recordings";

/** Terminal classification of one trial (ADD D-5). */
export type TrialOutcome = "retrieved" | "timed-out" | "errored";

/** The polling parameters a trial ran under, recorded per trial (FR-6). */
export interface PollParams {
  readonly pollIntervalMs: number;
  readonly timeoutMs: number;
}

/** One trial's complete record — the unit persisted after every trial (D-6). */
export interface TrialRecord {
  readonly signalType: SignalType;
  /** 0-based index within the leg. */
  readonly trialIndex: number;
  /** The fresh-per-trial marker (D3 multiplicity guard). */
  readonly marker: string;
  /** Epoch ms at capture success (or attempt, for errored captures). */
  readonly captureTimestamp: number;
  /** Epoch ms when any endpoint first returned the marker. Absent unless retrieved. */
  readonly firstRetrievableTimestamp?: number;
  /** Elapsed ms from capture to first match, per endpoint that matched (FR-10). */
  readonly elapsedMsByEndpoint: Partial<Record<PollEndpoint, number>>;
  readonly outcome: TrialOutcome;
  readonly pollParams: PollParams;
  /** Which endpoint satisfied retrievability first (FR-6). Absent unless retrieved. */
  readonly satisfyingEndpoint?: PollEndpoint;
  /** 429 responses observed while polling this trial (D-6 rate-limit note). */
  readonly http429Count: number;
  /** Poll-tick parse failures counted without aborting the loop (D-5). */
  readonly parseFailureCount: number;
  /**
   * How the recording leg produced THIS trial (ADD D-2 honesty requirement).
   * Present only on recording-leg trials, so a mixed-mode run (automated →
   * manual fallback mid-leg) is reconstructable per trial from the run file.
   */
  readonly mode?: RecordingMode;
}

/** Leg status: distinguishes "ran", "runner threw", and "excluded by flags". */
export type LegStatus = "completed" | "failed" | "not-run";

/** One leg's outcome — earlier legs' results survive a later leg's failure (D-6/D8). */
export interface LegResult {
  readonly signalType: SignalType;
  readonly status: LegStatus;
  readonly trials: readonly TrialRecord[];
  /** Present only when status is "failed". */
  readonly failureReason?: string;
}

/** How the recording leg produced its numbers (ADD D-2 honesty requirement). */
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

/** Run metadata. Host region string ONLY — never keys, never the project ID. */
export interface RunMetadata {
  /** ISO timestamp the run started. */
  readonly startedAt: string;
  /** e.g. "us" / "eu" / "self-hosted" — derived from POSTHOG_HOST, never the URL's key material. */
  readonly hostRegion: string;
}

/** The one-file-per-run persistence shape (ADD D-6). */
export interface RunFile {
  readonly metadata: RunMetadata;
  readonly config: RunConfig;
  readonly trials: readonly TrialRecord[];
}

/**
 * Parser fail direction (ADD D-5): malformed input is a NAMED failure, never a
 * throw and never a silent "not yet retrievable".
 */
export type ParseResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

/**
 * Stats fail direction (ADD D-5): empty input is an explicit no-data marker,
 * never NaN and never 0. `n` counts attempted trials (timeouts included in the
 * denominator); percentiles are computed over the retrieved subset.
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
