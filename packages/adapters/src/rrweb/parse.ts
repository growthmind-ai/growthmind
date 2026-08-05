import type { ReplayRecordingSummary, RrwebEvent } from "@growthmind/shared";
import { replayRecordingSummarySchema, rrwebEventSchema } from "@growthmind/shared";

import { isSameOriginAsHost } from "../http/origin";

const RECORDING_ENVELOPE_KEYS = ["recordings", "results", "data", "items"] as const;
const EVENT_ENVELOPE_KEYS = ["events", "results", "data"] as const;

const RECORDING_ID_KEYS = ["id", "recordingId", "recording_id"] as const;
// `timestamp` is what rrweb.com actually sends, as epoch milliseconds, and it is the only
// time on the item — observed 2026-08-05, scripts/spikes/notes/rrweb-read-api.md.
const STARTED_AT_KEYS = [
  "startedAt",
  "started_at",
  "createdAt",
  "created_at",
  "timestamp",
] as const;
const LAST_ACTIVITY_AT_KEYS = ["endedAt", "lastActivityAt", "updated_at"] as const;
const META_KEYS = ["metadata", "meta"] as const;
const CURSOR_KEYS = ["next", "nextCursor", "next_cursor"] as const;

export interface ParsedRecordingsPage {
  readonly recordings: ReplayRecordingSummary[];
  readonly next: string | null;
  readonly droppedMalformed: number;
}

export interface ParsedEventsPage {
  readonly events: RrwebEvent[];
  readonly next: string | null;
  readonly droppedMalformed: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function itemsOf(body: unknown, keys: readonly string[]): unknown[] | null {
  if (Array.isArray(body)) {
    return body;
  }
  const record = asRecord(body);
  if (record === null) {
    return null;
  }
  for (const key of keys) {
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }
  return null;
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value !== "") {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

function parseInstant(value: unknown): Date | null {
  // Numbers are epoch milliseconds: rrweb.com sends `timestamp` that way, and a
  // string-only reader silently returned null for every recording it listed.
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? new Date(value) : null;
  }
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  const epochMs = Date.parse(value);
  return Number.isNaN(epochMs) ? null : new Date(epochMs);
}

function firstRecord(
  record: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> | null {
  for (const key of keys) {
    const nested = asRecord(record[key]);
    if (nested !== null) {
      return nested;
    }
  }
  return null;
}

function firstInstant(record: Record<string, unknown>, keys: readonly string[]): Date | null {
  for (const key of keys) {
    const parsed = parseInstant(record[key]);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

function cursorOf(
  record: Record<string, unknown>,
  host: string,
): { cursor: string | null; malformed: boolean } {
  for (const key of CURSOR_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value !== "") {
      return isSameOriginAsHost(value, host)
        ? { cursor: value, malformed: false }
        : { cursor: null, malformed: true };
    }
  }
  return { cursor: null, malformed: false };
}

function parseRecordingItem(value: unknown): ReplayRecordingSummary | null {
  const item = asRecord(value);
  if (item === null) {
    return null;
  }

  const recordingId = firstString(item, RECORDING_ID_KEYS);
  if (recordingId === null) {
    return null;
  }

  const candidate = {
    recordingId,
    startedAt: firstInstant(item, STARTED_AT_KEYS),
    lastActivityAt: firstInstant(item, LAST_ACTIVITY_AT_KEYS),
    meta: firstRecord(item, META_KEYS) ?? {},
  };

  const parsed = replayRecordingSummarySchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function parseEventItem(value: unknown): RrwebEvent | null {
  const item = asRecord(value);
  if (item === null || !("data" in item)) {
    return null;
  }

  const parsed = rrwebEventSchema.safeParse({
    type: item.type,
    timestamp: item.timestamp,
    data: item.data,
  });
  return parsed.success ? parsed.data : null;
}

export function parseRecordingsPage(body: unknown, host: string): ParsedRecordingsPage {
  const items = itemsOf(body, RECORDING_ENVELOPE_KEYS);
  if (items === null) {
    return { recordings: [], next: null, droppedMalformed: 1 };
  }

  const recordings: ReplayRecordingSummary[] = [];
  let droppedMalformed = 0;

  for (let index = 0; index < items.length; index += 1) {
    const parsed = parseRecordingItem(items[index]);
    if (parsed === null) {
      droppedMalformed += 1;
      continue;
    }
    recordings.push(parsed);
  }

  const { cursor, malformed } = cursorOf(asRecord(body) ?? {}, host);
  if (malformed) {
    droppedMalformed += 1;
  }

  return { recordings, next: cursor, droppedMalformed };
}

export function parseEventsPage(body: unknown, host: string): ParsedEventsPage {
  const items = itemsOf(body, EVENT_ENVELOPE_KEYS);
  if (items === null) {
    return { events: [], next: null, droppedMalformed: 1 };
  }

  const events: RrwebEvent[] = [];
  let droppedMalformed = 0;

  for (let index = 0; index < items.length; index += 1) {
    const parsed = parseEventItem(items[index]);
    if (parsed === null) {
      droppedMalformed += 1;
      continue;
    }
    events.push(parsed);
  }

  const { cursor, malformed } = cursorOf(asRecord(body) ?? {}, host);
  if (malformed) {
    droppedMalformed += 1;
  }

  return { events, next: cursor, droppedMalformed };
}
