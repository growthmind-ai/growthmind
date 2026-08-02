import { normaliseUrlPath } from "@growthmind/shared";

import { PH_PROP } from "./constants";
import { parsePostHogInstant } from "./instant";

export interface RawEvent {
  readonly id: string;

  readonly event: string;
  readonly distinctId: string | null;

  readonly timestamp: Date;

  readonly sessionId: string | null;

  readonly userAgent: string | null;

  readonly urlPath: string | null;

  readonly setEmail: string | null;
}

export interface ParsedEventsPage {
  readonly events: RawEvent[];

  readonly droppedMalformed: number;

  readonly next: string | null;

  readonly firstItemDropped: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function parseEventItem(value: unknown): RawEvent | null {
  const item = asRecord(value);
  if (item === null) {
    return null;
  }

  const id = asString(item.id);
  const name = asString(item.event);
  const rawTimestamp = asString(item.timestamp);
  if (id === null || name === null || rawTimestamp === null) {
    return null;
  }

  const timestamp = parsePostHogInstant(rawTimestamp);
  if (timestamp === null) {
    return null;
  }

  const properties = asRecord(item.properties) ?? {};
  const pathname = asString(properties[PH_PROP.PATHNAME]);
  const currentUrl = asString(properties[PH_PROP.CURRENT_URL]);

  return {
    id,
    event: name,
    distinctId: asString(item.distinct_id),
    timestamp,
    sessionId: asString(properties[PH_PROP.SESSION_ID]),
    userAgent: asString(properties[PH_PROP.RAW_USER_AGENT]),

    urlPath:
      pathname === null && currentUrl === null ? null : normaliseUrlPath(pathname, currentUrl),
    setEmail: asString(asRecord(properties[PH_PROP.SET])?.email),
  };
}

export function parseEventsPage(json: unknown): ParsedEventsPage {
  const page = asRecord(json);
  const results = page === null ? null : page.results;

  const next = page === null ? null : asString(page.next);

  if (!Array.isArray(results)) {
    return { events: [], droppedMalformed: 1, next, firstItemDropped: false };
  }

  const events: RawEvent[] = [];
  let droppedMalformed = 0;
  let firstItemDropped = false;

  for (let index = 0; index < results.length; index += 1) {
    const parsed = parseEventItem(results[index]);
    if (parsed === null) {
      droppedMalformed += 1;

      if (index === 0) {
        firstItemDropped = true;
      }
      continue;
    }
    events.push(parsed);
  }

  return { events, droppedMalformed, next, firstItemDropped };
}

export function parsePersonsResponse(json: unknown): string | null {
  const envelope = asRecord(json);
  const results = envelope === null ? null : envelope.results;
  if (!Array.isArray(results)) {
    return null;
  }

  const first = asRecord(results[0]);
  if (first === null) {
    return null;
  }

  return asString(asRecord(first.properties)?.email);
}
