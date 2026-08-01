// Impure thin fetch wrappers for the PostHog capture and read APIs (file 8). NO
// decision logic lives here. Marker matching, outcome classification, and timeout
// accounting belong to lib/trial.ts; this module only turns HTTP responses into the
// typed shapes the trial loop consumes.
//
// Fail directions:
// Capture failures never throw. The trial loop expects a typed `{ ok: false, reason }`
//  so the trial classifies as `errored`.
// Read-side 401/403 throws a typed AuthError naming the likely cause (add swapped-key
//  guidance).
// Key material never appears in any reason or error message (public repo; raw output
//  gets pasted into issues). Response bodies are scrubbed of the keys we hold and
//  truncated before entering a reason string.

import { MARKER_PROP, captureUrl, eventsUrl, queryUrl, recordingsUrl } from "./constants";
import type { Credentials } from "./env";
import {
  matchesMarker,
  parseEventsResponse,
  parseQueryResponse,
  parseRecordingsResponse,
  type MarkerCandidate,
} from "./parse";
import type { CaptureResult, EndpointPollOutcome, PollResult } from "./trial";
import type { ParseResult } from "./types";

/**
 * Read-API authentication failure. Thrown (never returned) so the entrypoint
 * can surface the instructive message and stop polling immediately instead of burning
 * the whole timeout on a dead key.
 */
export class AuthError extends Error {
  constructor(endpointLabel: string, status: number) {
    super(
      `PostHog ${endpointLabel} returned ${status} (unauthorized): ` +
        "the personal (phx_) and project (phc_) keys may be swapped, or the " +
        "personal key lacks read scope for this project.",
    );
    this.name = "AuthError";
  }
}

/** Max characters of a response body allowed into a reason string. */
const REASON_BODY_LIMIT = 200;

function truncate(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length <= REASON_BODY_LIMIT
    ? collapsed
    : `${collapsed.slice(0, REASON_BODY_LIMIT)}…`;
}

/**
 * Removes any occurrence of the credential material we hold from text bound for a
 * reason string. The project ID is scrubbed too (Security L-1): it is not a key, but it
 * is deliberately kept out of the public repo and raw output gets pasted into issues.
 */
function scrubKeys(text: string, creds: Credentials): string {
  let scrubbed = text;
  for (const secret of [creds.projectApiKey, creds.personalApiKey, creds.projectId]) {
    if (secret !== "") scrubbed = scrubbed.replaceAll(secret, "[redacted]");
  }
  return scrubbed;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Safe reason fragment from a response body: scrubbed, then truncated. */
async function safeBody(response: Response, creds: Credentials): Promise<string> {
  try {
    return truncate(scrubKeys(await response.text(), creds));
  } catch {
    return "(unreadable body)";
  }
}

// Capture (write side, project phc_ key in the JSON body, no auth header)

/**
 * Captures one event carrying this trial's marker via the ingestion API. Returns a
 * typed CaptureResult. A non-2xx status or a network error is `{ ok: false, reason }`,
 * never a throw (the trial loop classifies it).
 */
export async function captureEvent(
  creds: Credentials,
  eventName: string,
  marker: string,
  extraProps?: Readonly<Record<string, unknown>>,
): Promise<CaptureResult> {
  const payload = {
    api_key: creds.projectApiKey,
    event: eventName,
    distinct_id: marker,
    properties: { [MARKER_PROP]: marker, ...extraProps },
    timestamp: new Date().toISOString(),
  };

  let response: Response;
  try {
    response = await fetch(captureUrl(creds.host), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    return {
      ok: false,
      reason: `capture network error: ${truncate(scrubKeys(messageOf(error), creds))}`,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: `capture API responded ${response.status}: ${await safeBody(response, creds)}`,
    };
  }
  return { ok: true };
}

// Read side (personal phx_ key as Bearer)

function readHeaders(creds: Credentials): Record<string, string> {
  return {
    Authorization: `Bearer ${creds.personalApiKey}`,
    "Content-Type": "application/json",
  };
}

/**
 * HogQL string with the marker value embedded as a single-quoted literal. Markers come
 * from our own UUID generator, but single quotes and backslashes are escaped anyway.
 * Selected columns match what parseQueryResponse aligns against: `event`,
 * `distinct_id`, `properties.gm_spike_marker`.
 */
function hogqlFor(marker: string): string {
  const escaped = marker.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
  return (
    `SELECT event, distinct_id, properties.${MARKER_PROP} FROM events ` +
    `WHERE properties.${MARKER_PROP} = '${escaped}' ORDER BY timestamp DESC LIMIT 10`
  );
}

/**
 * One endpoint's share of a poll tick: request → status triage → parse → marker match.
 * Network errors and non-2xx (except auth) become named parseFailure outcomes so the
 * poll loop continues; 429 sets the per-tick flag; 401/403 throws AuthError.
 */
async function pollEndpoint<T extends MarkerCandidate>(
  endpointLabel: string,
  creds: Credentials,
  request: () => Promise<Response>,
  parse: (body: unknown) => ParseResult<readonly T[]>,
  marker: string,
): Promise<EndpointPollOutcome> {
  let response: Response;
  try {
    response = await request();
  } catch (error) {
    return {
      matched: false,
      http429: false,
      parseFailure: `${endpointLabel} network error: ${truncate(scrubKeys(messageOf(error), creds))}`,
    };
  }

  if (response.status === 429) return { matched: false, http429: true };
  if (response.status === 401 || response.status === 403) {
    throw new AuthError(endpointLabel, response.status);
  }
  if (!response.ok) {
    return {
      matched: false,
      http429: false,
      parseFailure: `${endpointLabel} responded ${response.status}: ${await safeBody(response, creds)}`,
    };
  }

  let body: unknown;
  try {
    body = (await response.json()) as unknown;
  } catch {
    return {
      matched: false,
      http429: false,
      parseFailure: `${endpointLabel} response body was not valid JSON`,
    };
  }

  const parsed = parse(body);
  if (!parsed.ok) {
    return {
      matched: false,
      http429: false,
      parseFailure: `${endpointLabel}: ${parsed.reason}`,
    };
  }

  return {
    matched: parsed.value.some((candidate) => matchesMarker(candidate, marker)),
    http429: false,
  };
}

/**
 * One poll tick for the event legs: hits the events list API and the HogQL query API in
 * the same tick, returning both endpoints' outcomes so the trial loop records the
 * events-vs-HogQL delta. Requests run sequentially, the spike deliberately avoids
 * self-inflicted rate pressure.
 */
export async function pollEventOnce(creds: Credentials, marker: string): Promise<PollResult> {
  const eventsParams = new URLSearchParams({
    properties: JSON.stringify([
      { key: MARKER_PROP, value: marker, operator: "exact", type: "event" },
    ]),
  });

  const events = await pollEndpoint(
    "events list API",
    creds,
    () =>
      fetch(`${eventsUrl(creds.host, creds.projectId)}?${eventsParams.toString()}`, {
        method: "GET",
        headers: readHeaders(creds),
      }),
    parseEventsResponse,
    marker,
  );

  const query = await pollEndpoint(
    "HogQL query API",
    creds,
    () =>
      fetch(queryUrl(creds.host, creds.projectId), {
        method: "POST",
        headers: readHeaders(creds),
        body: JSON.stringify({
          query: { kind: "HogQLQuery", query: hogqlFor(marker) },
        }),
      }),
    parseQueryResponse,
    marker,
  );

  return { events, query };
}

// T1 event-vocabulary read.
//
// The poll helpers above all filter to one trial's marker, which is the opposite of
// what a vocabulary probe needs: it must see every event name in the window, including
// ones no code here knows to ask for. Hence an unfiltered page read, walked by cursor.

/**
 * One page of the events list API. `items` stay `unknown` on purpose. The probe's whole
 * question is which shapes are actually out there, so parsing belongs to
 * `lib/t1-vocabulary.ts`'s pure `toObservedEvents`, not here.
 */
/** `status` for a page that never got a response at all (network error). */
const NO_STATUS = 0;

/** Narrowing guard: a plain object usable as a string-keyed record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface EventsPage {
  /** HTTP status, or `0` when the request itself failed before a response. */
  readonly status: number;
  readonly items: readonly unknown[];
  /**
   * The envelope's `next`, an absolute url carrying every original param plus an
   * exclusive `before` (pinned by the shape probe, row 1), or null on the final page.
   */
  readonly next: string | null;
}

/**
 * Reads one page of the events list API by absolute url.
 *
 * Fail directions, matching `pollEndpoint` above: 401/403 throws `AuthError` (the
 * swapped-key guidance) rather than looking like an empty project. An auth failure read
 * as "no events" is exactly how a probe would manufacture a false absence. A non-2xx or
 * unparseable body returns `{ items: [], next: null }` with the status carried, so the
 * caller stops the walk and reports a short sample rather than silently treating a
 * truncated read as the whole corpus.
 */
export async function fetchEventsPage(creds: Credentials, url: string): Promise<EventsPage> {
  let response: Response;
  try {
    response = await fetch(url, { method: "GET", headers: readHeaders(creds) });
  } catch {
    // A network error carries no status. `0` is the caller's signal that the read
    // failed rather than returned nothing: it stops the walk and the entrypoint reports
    // a short sample, which cannot support an absence claim.
    return { status: NO_STATUS, items: [], next: null };
  }

  if (response.status === 401 || response.status === 403) {
    throw new AuthError("events list API", response.status);
  }
  if (!response.ok) return { status: response.status, items: [], next: null };

  let body: unknown;
  try {
    body = (await response.json()) as unknown;
  } catch {
    return { status: response.status, items: [], next: null };
  }

  // Items stay `unknown`: which shapes are out there IS the probe's question, so
  // nothing is coerced here. A missing/!array `results` yields an empty page and a null
  // cursor. The walk stops rather than looping on a shape we do not recognise.
  if (!isRecord(body) || !Array.isArray(body.results)) {
    return { status: response.status, items: [], next: null };
  }
  return {
    status: response.status,
    items: body.results as readonly unknown[],
    next: typeof body.next === "string" && body.next !== "" ? body.next : null,
  };
}

/**
 * One poll tick for the recording leg: a recording is retrievable when it is listed for
 * this trial's identified distinct_id. Listed, not playable, per the prd's explicit
 * out-of-scope.
 */
export async function pollRecordingOnce(creds: Credentials, marker: string): Promise<PollResult> {
  const params = new URLSearchParams({ distinct_id: marker });

  const recordings = await pollEndpoint(
    "session recordings API",
    creds,
    () =>
      fetch(`${recordingsUrl(creds.host, creds.projectId)}?${params.toString()}`, {
        method: "GET",
        headers: readHeaders(creds),
      }),
    parseRecordingsResponse,
    marker,
  );

  return { recordings };
}
