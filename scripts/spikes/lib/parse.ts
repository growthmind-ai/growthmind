// Pure parsers for the three read-API response shapes (ADD §4 file 6, D-3).
// Fail directions (D-5): malformed / missing-field input → named
// `{ ok: false, reason }`; an empty results array is a valid empty match,
// never a failure; nothing here ever throws on bad input.

import { MARKER_PROP } from "./constants";
import type { ParseResult } from "./types";

/** An event candidate from the events list API or a HogQL query row. */
export interface CandidateEvent {
  /** Event name, e.g. "gm_spike_custom_event" or "$exception". */
  readonly event: string;
  readonly distinctId?: string;
  /** Raw properties — marker matching reads MARKER_PROP from here. */
  readonly properties: Readonly<Record<string, unknown>>;
}

/** A recording candidate from the session_recordings list API. */
export interface CandidateRecording {
  readonly id: string;
  readonly distinctId?: string;
}

/** Anything `matchesMarker` can test — an event or a recording. */
export type MarkerCandidate = CandidateEvent | CandidateRecording;

/** Narrowing guard: a plain object usable as a string-keyed record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Extracts `body.results` as an array, or names why it can't. */
function resultsArray(body: unknown): ParseResult<readonly unknown[]> {
  if (!isRecord(body)) {
    return { ok: false, reason: "response body is not an object" };
  }
  const { results } = body;
  if (!Array.isArray(results)) {
    return {
      ok: false,
      reason:
        results === undefined
          ? "response body has no `results` field"
          : "response `results` is not an array",
    };
  }
  return { ok: true, value: results };
}

/** Parses `GET /api/projects/:id/events` response body (D-3 primary). */
export function parseEventsResponse(body: unknown): ParseResult<readonly CandidateEvent[]> {
  const results = resultsArray(body);
  if (!results.ok) return results;

  const candidates: CandidateEvent[] = [];
  for (const [index, entry] of results.value.entries()) {
    if (!isRecord(entry)) {
      return { ok: false, reason: `events results[${index}] is not an object` };
    }
    if (typeof entry.event !== "string") {
      return {
        ok: false,
        reason: `events results[${index}] is missing a string \`event\``,
      };
    }
    if (!isRecord(entry.properties)) {
      return {
        ok: false,
        reason: `events results[${index}] is missing an object \`properties\``,
      };
    }
    candidates.push({
      event: entry.event,
      ...(typeof entry.distinct_id === "string" ? { distinctId: entry.distinct_id } : {}),
      properties: entry.properties,
    });
  }
  return { ok: true, value: candidates };
}

/** Parses `POST /api/projects/:id/query` HogQL response body (D-3 secondary). */
export function parseQueryResponse(body: unknown): ParseResult<readonly CandidateEvent[]> {
  const results = resultsArray(body);
  if (!results.ok) return results;
  if (results.value.length === 0) return { ok: true, value: [] };

  // Column lookup only matters once there are rows to align against.
  const columns = isRecord(body) ? body.columns : undefined;
  if (!Array.isArray(columns)) {
    return { ok: false, reason: "query response `columns` is not an array" };
  }
  const eventIdx = columns.indexOf("event");
  const distinctIdIdx = columns.indexOf("distinct_id");
  const markerIdx = columns.indexOf(`properties.${MARKER_PROP}`);
  if (eventIdx === -1) {
    return { ok: false, reason: "query response has no `event` column" };
  }
  if (markerIdx === -1) {
    return {
      ok: false,
      reason: `query response has no \`properties.${MARKER_PROP}\` column`,
    };
  }

  const candidates: CandidateEvent[] = [];
  for (const [index, row] of results.value.entries()) {
    if (!Array.isArray(row)) {
      return { ok: false, reason: `query results[${index}] is not a row array` };
    }
    const event: unknown = row[eventIdx];
    if (typeof event !== "string") {
      return {
        ok: false,
        reason: `query results[${index}] has no string value in the \`event\` column`,
      };
    }
    const distinctId: unknown = distinctIdIdx === -1 ? undefined : row[distinctIdIdx];
    candidates.push({
      event,
      ...(typeof distinctId === "string" ? { distinctId } : {}),
      properties: { [MARKER_PROP]: row[markerIdx] },
    });
  }
  return { ok: true, value: candidates };
}

/** Parses `GET /api/projects/:id/session_recordings` response body. */
export function parseRecordingsResponse(body: unknown): ParseResult<readonly CandidateRecording[]> {
  const results = resultsArray(body);
  if (!results.ok) return results;

  const candidates: CandidateRecording[] = [];
  for (const [index, entry] of results.value.entries()) {
    if (!isRecord(entry)) {
      return {
        ok: false,
        reason: `recordings results[${index}] is not an object`,
      };
    }
    if (typeof entry.id !== "string") {
      return {
        ok: false,
        reason: `recordings results[${index}] is missing a string \`id\``,
      };
    }
    candidates.push({
      id: entry.id,
      ...(typeof entry.distinct_id === "string" ? { distinctId: entry.distinct_id } : {}),
    });
  }
  return { ok: true, value: candidates };
}

/**
 * The D3-multiplicity guard: true only when the candidate carries THIS trial's
 * marker — events match on the MARKER_PROP property, recordings on
 * distinct_id. An event with the right name but a prior trial's/run's marker
 * must NOT match (the false-near-zero-latency guard).
 */
export function matchesMarker(candidate: MarkerCandidate, marker: string): boolean {
  if ("properties" in candidate) {
    return candidate.properties[MARKER_PROP] === marker;
  }
  return candidate.distinctId === marker;
}
