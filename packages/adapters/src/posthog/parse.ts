// Boundary parsing for the PostHog events and persons responses
// (O-003 D-13, Addendum A ROW 1 / ROW 5 / ROW 6).
//
// PER-ITEM DEGRADATION, NEVER PER-PAGE. The spike's parser returns a named
// failure for the whole `results` array when one entry is malformed — correct
// for a harness, a LIVENESS HAZARD for a poller, where one weird event would
// stall a connection forever. Here a malformed item is skipped, COUNTED, and
// the count surfaced on the poll run and in the counter's
// `droppedUnreadable`. Never silently discarded.
//
// TYPED STUB (O-003 scaffold): the types are final; the bodies throw.

/**
 * One event as it leaves the parser — still internal to the adapter. Note
 * what is NOT here: `person`. It is `null` on every item (165/165), so any
 * code reading `event.person.properties.email` is dead code, and the parser
 * does not read the key at all.
 */
export interface RawEvent {
  /** PostHog's server-assigned `id` — a string UUIDv7, stored opaquely and
   * never as a `uuid` column, since the v7-ness is an observation about this
   * deployment rather than a contract. */
  readonly id: string;
  /** The event name, as-is. Never re-authored. */
  readonly event: string;
  readonly distinctId: string | null;
  /** PostHog's client-declared EVENT time, parsed — never string-compared. */
  readonly timestamp: Date;
  /** `$session_id` when the SDK set one (SEC-C). */
  readonly sessionId: string | null;
  /** `$raw_user_agent` when the SDK sent one (SEC-A). Absent is normal. */
  readonly userAgent: string | null;
  /** Normalised from `$pathname`, falling back to `$current_url` with the
   * query string and fragment stripped (SEC-B). Never the raw url. */
  readonly urlPath: string | null;
  /** `properties.$set.email` on identify-shaped events only (ROW 6). Used
   * for identity harvest inside the adapter; only its DOMAIN ever crosses the
   * port boundary. */
  readonly setEmail: string | null;
}

export interface ParsedEventsPage {
  readonly events: RawEvent[];
  /** Items skipped because they could not be read. Counted, never hidden. */
  readonly droppedMalformed: number;
  /**
   * The absolute `next` url, VERBATIM, or `null`. Branch on `null` — it is
   * literal `null` on the final page, never absent and never `""` — and never
   * treat "fewer rows than `limit`" as an end signal.
   */
  readonly next: string | null;
}

/** Parses one page of `GET /api/projects/{id}/events`. */
export function parseEventsPage(_json: unknown): ParsedEventsPage {
  throw new Error("TYPED STUB (O-003 scaffold): parseEventsPage");
}

/**
 * Reads `results[0].properties.email` out of a persons response, or `null`.
 *
 * DELIBERATELY PERMISSIVE: the persons envelope beyond this one field is an
 * ASSUMED shape, never pinned. The parser therefore requires only that
 * `results` is an array and that `results[0]?.properties?.email` is an
 * optional string; every other key is tolerated, present or absent. Anything
 * stricter would turn an unpinned shape into a liveness risk.
 */
export function parsePersonsResponse(_json: unknown): string | null {
  throw new Error("TYPED STUB (O-003 scaffold): parsePersonsResponse");
}
