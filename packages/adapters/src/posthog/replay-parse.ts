import { Buffer } from "node:buffer";
import zlib from "node:zlib";

import type { ReplayRecordingSummary, RrwebEvent } from "@growthmind/shared";
import { replayRecordingSummarySchema, rrwebEventSchema } from "@growthmind/shared";

const RECORDING_META_KEYS = [
  "recording_duration",
  "click_count",
  "keypress_count",
  "mouse_activity_count",
  "console_error_count",
  "start_url",
] as const;

export interface ParsedRecordingsPage {
  readonly recordings: ReplayRecordingSummary[];
  readonly next: string | null;
  readonly droppedMalformed: number;
}

export interface SnapshotSource {
  readonly source: string;
  readonly blobKey: string;
}

export interface ParsedSnapshotSources {
  readonly sources: SnapshotSource[];
  readonly droppedMalformed: number;
}

export interface BlobKeyRange {
  readonly start: string;
  readonly end: string;
}

export interface ParsedSnapshotJsonl {
  readonly events: RrwebEvent[];
  readonly windowIds: string[];
  readonly droppedMalformed: number;
  readonly decompressionFailures: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asId(value: unknown): string | null {
  if (typeof value === "string" && value !== "") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function asBlobKey(value: unknown): string | null {
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return String(value);
  return null;
}

function parseInstant(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const epochMs = Date.parse(value);
  return Number.isNaN(epochMs) ? null : new Date(epochMs);
}

function recordingMeta(item: Record<string, unknown>): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  for (const key of RECORDING_META_KEYS) {
    if (key in item) {
      meta[key] = item[key];
    }
  }
  return meta;
}

function parseRecordingItem(value: unknown): ReplayRecordingSummary | null {
  const item = asRecord(value);
  if (item === null) return null;

  const recordingId = asId(item.id);
  if (recordingId === null) return null;

  const candidate = {
    recordingId,
    startedAt: parseInstant(item.start_time),
    lastActivityAt: parseInstant(item.end_time),
    meta: recordingMeta(item),
  };

  const parsed = replayRecordingSummarySchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export function parseRecordingsPage(body: unknown): ParsedRecordingsPage {
  const envelope = asRecord(body);
  const results = envelope === null ? null : envelope.results;
  if (!Array.isArray(results)) {
    return { recordings: [], next: null, droppedMalformed: 1 };
  }

  const recordings: ReplayRecordingSummary[] = [];
  let droppedMalformed = 0;

  for (let index = 0; index < results.length; index += 1) {
    const parsed = parseRecordingItem(results[index]);
    if (parsed === null) {
      droppedMalformed += 1;
      continue;
    }
    recordings.push(parsed);
  }

  const next = envelope === null ? null : asNonEmptyString(envelope.next);

  return { recordings, next, droppedMalformed };
}

function parseSnapshotSourceItem(value: unknown): SnapshotSource | null {
  const item = asRecord(value);
  if (item === null) return null;

  const source = asNonEmptyString(item.source);
  const blobKey = asBlobKey(item.blob_key);
  if (source === null || blobKey === null) return null;

  return { source, blobKey };
}

export function parseSnapshotSources(body: unknown): ParsedSnapshotSources {
  const envelope = asRecord(body);
  const results = envelope === null ? null : envelope.sources;
  if (!Array.isArray(results)) {
    return { sources: [], droppedMalformed: 1 };
  }

  const sources: SnapshotSource[] = [];
  let droppedMalformed = 0;

  for (let index = 0; index < results.length; index += 1) {
    const parsed = parseSnapshotSourceItem(results[index]);
    if (parsed === null) {
      droppedMalformed += 1;
      continue;
    }
    sources.push(parsed);
  }

  return { sources, droppedMalformed };
}

export function blobKeyRange(sources: readonly SnapshotSource[]): BlobKeyRange | null {
  if (sources.length === 0) return null;

  let start = sources[0].blobKey;
  let end = sources[0].blobKey;
  let startValue = Number(start);
  let endValue = Number(end);

  for (let index = 1; index < sources.length; index += 1) {
    const blobKey = sources[index].blobKey;
    const value = Number(blobKey);
    if (value < startValue) {
      start = blobKey;
      startValue = value;
    }
    if (value > endValue) {
      end = blobKey;
      endValue = value;
    }
  }

  return { start, end };
}

// The wire's compression marker (`cv`) means `data` is a gzip payload smuggled
// through JSON as a string of raw byte values — latin1 is the encoding that
// round-trips those bytes unchanged, unlike utf8.
function decompressEventData(raw: string): { ok: true; data: unknown } | { ok: false } {
  try {
    const inflated = zlib.gunzipSync(Buffer.from(raw, "latin1"));
    return { ok: true, data: JSON.parse(inflated.toString("utf8")) };
  } catch {
    return { ok: false };
  }
}

export function parseSnapshotJsonl(text: string): ParsedSnapshotJsonl {
  const events: RrwebEvent[] = [];
  const windowIds: string[] = [];
  const seenWindowIds = new Set<string>();
  let droppedMalformed = 0;
  let decompressionFailures = 0;

  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line === "") continue;

    let tuple: unknown;
    try {
      tuple = JSON.parse(line);
    } catch {
      droppedMalformed += 1;
      continue;
    }

    if (!Array.isArray(tuple) || tuple.length !== 2) {
      droppedMalformed += 1;
      continue;
    }

    const windowId = asNonEmptyString(tuple[0]);
    const rawEvent = asRecord(tuple[1]);
    if (windowId === null || rawEvent === null) {
      droppedMalformed += 1;
      continue;
    }

    if (!seenWindowIds.has(windowId)) {
      seenWindowIds.add(windowId);
      windowIds.push(windowId);
    }

    let data: unknown = rawEvent.data;
    if (typeof rawEvent.cv === "string" && typeof rawEvent.data === "string") {
      const decompressed = decompressEventData(rawEvent.data);
      if (!decompressed.ok) {
        decompressionFailures += 1;
        continue;
      }
      data = decompressed.data;
    }

    const parsedEvent = rrwebEventSchema.safeParse({
      type: rawEvent.type,
      timestamp: rawEvent.timestamp,
      data,
    });
    if (!parsedEvent.success) {
      droppedMalformed += 1;
      continue;
    }
    events.push(parsedEvent.data);
  }

  return { events, windowIds, droppedMalformed, decompressionFailures };
}
