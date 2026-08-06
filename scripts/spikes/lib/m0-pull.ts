export type PullOutcome = "pulled" | "partial" | "timeout" | "errored";

export interface RecordingPullRecord {
  readonly recordingId: string;
  readonly outcome: PullOutcome;

  readonly bytes: number;

  readonly declaredBytes: number;
  readonly largestResponseBytes: number;
  readonly responses: number;

  readonly wallClockMs: number;

  readonly eventCount: number;
  readonly actionCount: number;
  readonly transcriptMs: number;
  readonly stop: string | null;
  readonly droppedMalformed: number;
  readonly reason: string | null;
}

export interface Distribution {
  readonly n: number;
  readonly p50: number;
  readonly p90: number;
  readonly max: number;
}

export function percentile(sorted: readonly number[], p: number): number {
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, index))] as number;
}

export function distributionOf(values: readonly number[]): Distribution | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  return {
    n: sorted.length,
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    max: sorted[sorted.length - 1] as number,
  };
}

export const MIB = 1024 * 1024;

// "MB" in the FR-0.2 table is read as MiB: ADD §7 rounds the p90 up to the next power of
// two, and a decimal reading of the same table would move MAX_PULL_BYTES by 5%.
export const FR02_THRESHOLDS = {
  shipBytes: 5 * MIB,
  stopBytes: 25 * MIB,
  shipMs: 10_000,
  stopMs: 30_000,
  overlapFloor: 0.5,
} as const;

// Reproduced from PRD FR-0.2, confirmed by Tom 2026-08-05 before M-0 ran. AC-0.5 fails the
// sprint on a diff to these numbers, so they are asserted in __tests__/m0-pull.test.ts.
export const FR02_TABLE_ROWS: readonly string[] = [
  "bytes <= 5 MB AND wall-clock <= 10 s AND join overlap >= 50%   ->  Ship as specified",
  "bytes 5-25 MB OR wall-clock 10-30 s (overlap still >= 50%)     ->  Ship, with the byte bound and a reduced per-tick cap mandatory this sprint",
  "bytes > 25 MB OR wall-clock > 30 s                             ->  STOP - close the outcome on the number, escalate",
  "join overlap < 50% of ph:-prefixed sessions                    ->  STOP on the join premise - escalate",
];

export type BranchId =
  "ship_as_specified" | "ship_with_mandatory_bound" | "stop_on_numbers" | "stop_on_join";

export interface BranchDecision {
  readonly branch: BranchId;
  readonly label: string;
  readonly stops: boolean;
  readonly reasons: readonly string[];
}

export interface BranchInput {
  readonly p90Bytes: number;
  readonly p90Ms: number;
  readonly overlap: number;
}

const BRANCH_LABELS: Readonly<Record<BranchId, string>> = {
  ship_as_specified: "Ship as specified. All FRs proceed.",
  ship_with_mandatory_bound:
    "Ship, with FR-6's byte bound and a reduced RECORDINGS_NARRATED_PER_TICK mandatory in this sprint.",
  stop_on_numbers:
    "STOP. Close the outcome on the number. Escalate to Tom. Do not ship the persistence layer.",
  stop_on_join:
    "STOP on the join premise. The natural-key hypothesis is wrong and the chain needs a different join. Escalate to Tom.",
};

export function selectBranch(input: BranchInput): BranchDecision {
  const { shipBytes, stopBytes, shipMs, stopMs, overlapFloor } = FR02_THRESHOLDS;
  const reasons: string[] = [];

  const bytesStop = input.p90Bytes > stopBytes;
  const msStop = input.p90Ms > stopMs;
  const joinStop = input.overlap < overlapFloor;

  if (bytesStop)
    reasons.push(`p90 bytes ${formatBytes(input.p90Bytes)} is over the 25 MB stop band`);
  if (msStop) reasons.push(`p90 wall-clock ${formatMs(input.p90Ms)} is over the 30 s stop band`);
  if (joinStop) reasons.push(`join overlap ${formatPercent(input.overlap)} is under the 50% floor`);

  const branch: BranchId =
    bytesStop || msStop
      ? "stop_on_numbers"
      : joinStop
        ? "stop_on_join"
        : input.p90Bytes <= shipBytes && input.p90Ms <= shipMs
          ? "ship_as_specified"
          : "ship_with_mandatory_bound";

  if (branch === "ship_as_specified") {
    reasons.push(
      `p90 bytes ${formatBytes(input.p90Bytes)} is within 5 MB, p90 wall-clock ${formatMs(input.p90Ms)} is within 10 s, overlap ${formatPercent(input.overlap)} clears 50%`,
    );
  }
  if (branch === "ship_with_mandatory_bound") {
    if (input.p90Bytes > shipBytes) {
      reasons.push(`p90 bytes ${formatBytes(input.p90Bytes)} is in the 5-25 MB band`);
    }
    if (input.p90Ms > shipMs) {
      reasons.push(`p90 wall-clock ${formatMs(input.p90Ms)} is in the 10-30 s band`);
    }
    reasons.push(`overlap ${formatPercent(input.overlap)} clears the 50% floor`);
  }

  return {
    branch,
    label: BRANCH_LABELS[branch],
    stops: branch === "stop_on_numbers" || branch === "stop_on_join",
    reasons,
  };
}

export const CURRENT_RECORDINGS_NARRATED_PER_TICK = 25;
export const TICK_INTERVAL_MS = 600_000;
export const TICK_DUTY_CYCLE = 0.5;

export function nextPowerOfTwo(value: number): number {
  if (!Number.isFinite(value) || value <= 1) return 1;
  let power = 1;
  for (let exponent = 0; exponent < 52; exponent += 1) {
    if (power >= value) return power;
    power *= 2;
  }
  return power;
}

export interface DerivedConstants {
  readonly maxPullBytes: number;
  readonly measuredP90PullMs: number;
  readonly recordingsNarratedPerTick: number;
}

export function deriveConstants(p90Bytes: number, p90Ms: number): DerivedConstants {
  const perTick =
    p90Ms <= 0
      ? CURRENT_RECORDINGS_NARRATED_PER_TICK
      : Math.min(
          CURRENT_RECORDINGS_NARRATED_PER_TICK,
          Math.floor((TICK_DUTY_CYCLE * TICK_INTERVAL_MS) / p90Ms),
        );

  return {
    maxPullBytes: nextPowerOfTwo(p90Bytes),
    measuredP90PullMs: p90Ms,
    recordingsNarratedPerTick: perTick,
  };
}

export function groupDigits(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  const digits = Math.abs(rounded).toString();
  let out = "";
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ",";
    out += digits[i];
  }
  return `${sign}${out}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${groupDigits(bytes)} B`;
  if (bytes < MIB) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / MIB).toFixed(2)} MiB`;
}

export function formatBytesExact(bytes: number): string {
  return `${formatBytes(bytes)} (${groupDigits(bytes)} bytes)`;
}

export function formatMs(ms: number): string {
  return ms < 1000 ? `${groupDigits(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

const ID_COLUMN_WIDTH = 26;

function truncateId(recordingId: string): string {
  return recordingId.length <= ID_COLUMN_WIDTH
    ? recordingId
    : `${recordingId.slice(0, ID_COLUMN_WIDTH - 1)}…`;
}

const COLUMNS: readonly { readonly header: string; readonly width: number }[] = [
  { header: "#", width: 4 },
  { header: "recording", width: ID_COLUMN_WIDTH + 2 },
  { header: "outcome", width: 10 },
  { header: "bytes", width: 13 },
  { header: "wall-clock", width: 12 },
  { header: "events", width: 8 },
  { header: "actions", width: 9 },
  { header: "stop", width: 10 },
  { header: "reason", width: 0 },
];

function row(cells: readonly string[]): string {
  return cells
    .map((cell, index) => cell.padEnd(COLUMNS[index]?.width ?? 0))
    .join("")
    .trimEnd();
}

export function renderRecordingTable(records: readonly RecordingPullRecord[]): string {
  const header = row(COLUMNS.map((column) => column.header));
  const rule = row(COLUMNS.map((column) => "-".repeat(Math.max(column.header.length, 1))));

  const body = records.map((record, index) =>
    row([
      String(index + 1),
      truncateId(record.recordingId),
      record.outcome,
      formatBytes(record.bytes),
      formatMs(record.wallClockMs),
      groupDigits(record.eventCount),
      groupDigits(record.actionCount),
      record.stop ?? "-",
      record.reason ?? "",
    ]),
  );

  return [header, rule, ...body].join("\n");
}

export interface ProbeSummary {
  readonly n: number;
  readonly nPulled: number;
  readonly nPartial: number;
  readonly nTimedOut: number;
  readonly nErrored: number;
  readonly bytes: Distribution;
  readonly wallClock: Distribution;
  readonly totalBytes: number;
  readonly largestResponseBytes: number;
}

export function summarise(records: readonly RecordingPullRecord[]): ProbeSummary | null {
  const bytes = distributionOf(records.map((record) => record.bytes));
  const wallClock = distributionOf(records.map((record) => record.wallClockMs));
  if (bytes === null || wallClock === null) return null;

  const count = (outcome: PullOutcome): number =>
    records.filter((record) => record.outcome === outcome).length;

  return {
    n: records.length,
    nPulled: count("pulled"),
    nPartial: count("partial"),
    nTimedOut: count("timeout"),
    nErrored: count("errored"),
    bytes,
    wallClock,
    totalBytes: records.reduce((sum, record) => sum + record.bytes, 0),
    largestResponseBytes: records.reduce(
      (largest, record) => Math.max(largest, record.largestResponseBytes),
      0,
    ),
  };
}
