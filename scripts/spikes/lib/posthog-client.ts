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

const REASON_BODY_LIMIT = 200;

function truncate(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length <= REASON_BODY_LIMIT
    ? collapsed
    : `${collapsed.slice(0, REASON_BODY_LIMIT)}…`;
}

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

async function safeBody(response: Response, creds: Credentials): Promise<string> {
  try {
    return truncate(scrubKeys(await response.text(), creds));
  } catch {
    return "(unreadable body)";
  }
}

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

function readHeaders(creds: Credentials): Record<string, string> {
  return {
    Authorization: `Bearer ${creds.personalApiKey}`,
    "Content-Type": "application/json",
  };
}

function hogqlFor(marker: string): string {
  const escaped = marker.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
  return (
    `SELECT event, distinct_id, properties.${MARKER_PROP} FROM events ` +
    `WHERE properties.${MARKER_PROP} = '${escaped}' ORDER BY timestamp DESC LIMIT 10`
  );
}

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

const NO_STATUS = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface EventsPage {
  readonly status: number;
  readonly items: readonly unknown[];

  readonly next: string | null;
}

export async function fetchEventsPage(creds: Credentials, url: string): Promise<EventsPage> {
  let response: Response;
  try {
    response = await fetch(url, { method: "GET", headers: readHeaders(creds) });
  } catch {
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

  if (!isRecord(body) || !Array.isArray(body.results)) {
    return { status: response.status, items: [], next: null };
  }
  return {
    status: response.status,
    items: body.results as readonly unknown[],
    next: typeof body.next === "string" && body.next !== "" ? body.next : null,
  };
}

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
