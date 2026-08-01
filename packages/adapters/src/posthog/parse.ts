// Boundary parsing for the PostHog events and persons responses (Addendum a row 1 / row
// 5 / row 6).
//
// Per-item degradation, never per-page. The spike's parser returns a named failure for
// the whole `results` array when one entry is malformed. Correct for a harness, a
// liveness hazard for a poller, where one weird event would stall a connection forever.
// Here a malformed item is skipped, counted, and the count surfaced on the poll run and
// in the counter's `droppedUnreadable`. Never silently discarded.
import { normaliseUrlPath } from "@growthmind/shared";

import { PH_PROP } from "./constants";
import { parsePostHogInstant } from "./instant";

/**
 * One event as it leaves the parser. Still internal to the adapter. Note what is not
 * here: `person`. It is `null` on every item, so any code reading
 * `event.person.properties.email` is dead code, and the parser does not read the key at
 * all.
 */
export interface RawEvent {
  /** PostHog's server-assigned `id`, a string UUIDv7, stored opaquely and never as a
   * `uuid` column, since the v7-ness is an observation about this deployment rather
   * than a contract. */
  readonly id: string;
  /** The event name, as-is. Never re-authored. */
  readonly event: string;
  readonly distinctId: string | null;
  /** PostHog's client-declared event time, parsed, never string-compared. */
  readonly timestamp: Date;
  /** `$session_id` when the SDK set one (sec-c). */
  readonly sessionId: string | null;
  /** `$raw_user_agent` when the SDK sent one (sec-a). Absent is normal. */
  readonly userAgent: string | null;
  /** Normalised from `$pathname`, falling back to `$current_url` with the query string
   * and fragment stripped (sec-b). Never the raw url. */
  readonly urlPath: string | null;
  /** `properties.$set.email` on identify-shaped events only (row 6). Used for identity
   * harvest inside the adapter; only its domain ever crosses the port boundary. */
  readonly setEmail: string | null;
}

export interface ParsedEventsPage {
  readonly events: RawEvent[];
  /** Items skipped because they could not be read. Counted, never hidden. */
  readonly droppedMalformed: number;
  /**
   * The absolute `next` url, verbatim, or `null`. Branch on `null`, it is literal
   * `null` on the final page, never absent and never `""`, and never treat "fewer rows
   * than `limit`" as an end signal.
   */
  readonly next: string | null;
  /**
   * `true` when `results[0]` existed but could not be parsed. `false` for a page with
   * no items at all. That is "nothing to be newest of", not "an unreadable newest
   * item".
   *
   * The walk (`session-source.ts`) must never derive `firstItemAt` from `events[0]`
   * when this is `true`: `events[0]` there is a later (older) item than the genuinely
   * newest one, and trusting it as "everything at or after this instant is captured"
   * would let the exclusive `after`/`before` boundary silently age the unparsed item
   * out of the overlap window and lose it for good. Visible only as a rising
   * `droppedMalformed` count.
   */
  readonly firstItemDropped: boolean;
}

/** A plain object, for the handful of places this parser steps into one. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A non-empty string, or `null`. Every optional PostHog property goes through here, so
 * a number or an object where a string was expected degrades to "absent" rather than to
 * a wrong-typed value downstream. */
function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * One item, parsed by hand rather than by an object schema.
 *
 * That is deliberate: `person` must never even be read (it is `null` on 165/165 items,
 * so anything reaching through it is dead code), and a schema that enumerates or strips
 * unknown keys would touch it. Reading only the six keys we use makes the dead-code
 * guard structural instead of a convention.
 *
 * Returns `null` for an item that cannot be read, which the caller counts.
 */
function parseEventItem(value: unknown): RawEvent | null {
  const item = asRecord(value);
  if (item === null) {
    return null;
  }

  // The three load-bearing fields. `id` is the idempotency key and `event` is the name
  // we persist verbatim; without either the row cannot be stored at all, so the item is
  // unreadable rather than partial.
  const id = asString(item.id);
  const name = asString(item.event);
  const rawTimestamp = asString(item.timestamp);
  if (id === null || name === null || rawTimestamp === null) {
    return null;
  }

  // Parsed, never string-compared: `…891000+00:00` and `…891Z` are the same instant and
  // different strings.
  const timestamp = parsePostHogInstant(rawTimestamp);
  if (timestamp === null) {
    return null;
  }

  // Everything below is SDK-set and optional (sec-a/B/C). PostHog derives none of it
  // server-side, so absent is normal and never a parse failure.
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
    // Short-circuit when there is nothing to normalise: the normaliser's own contract
    // is "null when neither input yields a usable path", so this is the same answer
    // without the call.
    urlPath:
      pathname === null && currentUrl === null ? null : normaliseUrlPath(pathname, currentUrl),
    setEmail: asString(asRecord(properties[PH_PROP.SET])?.email),
  };
}

/** Parses one page of `GET /api/projects/{id}/events`. */
export function parseEventsPage(json: unknown): ParsedEventsPage {
  const page = asRecord(json);
  const results = page === null ? null : page.results;

  // `next` is literal null on the final page, never absent, never "". Anything that is
  // not a usable string is treated as "no cursor"; a short page is never an end signal,
  // only this is.
  const next = page === null ? null : asString(page.next);

  if (!Array.isArray(results)) {
    // The whole envelope is unreadable. It is reported as one dropped item rather than
    // as a clean empty page, because an empty page is never authoritative here (row 2)
    // and a silent zero is exactly the failure this adapter is built to avoid. There is
    // no `results[0]` to speak of, so `firstItemDropped` is `false`. The walk already
    // treats an empty `events` array as "nothing to seed `firstItemAt` from" on its
    // own.
    return { events: [], droppedMalformed: 1, next, firstItemDropped: false };
  }

  const events: RawEvent[] = [];
  let droppedMalformed = 0;
  let firstItemDropped = false;

  for (let index = 0; index < results.length; index += 1) {
    const parsed = parseEventItem(results[index]);
    if (parsed === null) {
      // Per item, never per page. One weird event costs itself and nothing else, and is
      // counted, so it can never be silently discarded.
      droppedMalformed += 1;
      // Index 0 specifically is the page's claimed newest item. If it is the one that
      // could not be read, the caller must not treat any later item on this page as
      // "the newest". That would fabricate a watermark past an event we never captured.
      if (index === 0) {
        firstItemDropped = true;
      }
      continue;
    }
    events.push(parsed);
  }

  return { events, droppedMalformed, next, firstItemDropped };
}

/**
 * Reads `results[0].properties.email` out of a persons response, or `null`.
 *
 * Deliberately permissive: the persons envelope beyond this one field is an assumed
 * shape, never pinned. The parser therefore requires only that `results` is an array
 * and that `results[0]?.properties?.email` is an optional string; every other key is
 * tolerated, present or absent. Anything stricter would turn an unpinned shape into a
 * liveness risk.
 */
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

  // A non-string `email` is tolerated as "no email", never thrown: this envelope was
  // never pinned beyond this one field, and anything stricter would turn an unpinned
  // shape into a liveness risk.
  return asString(asRecord(first.properties)?.email);
}
