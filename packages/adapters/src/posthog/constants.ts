// Every cross-boundary literal the PostHog adapter uses: URL builders, property keys,
// and the tuning constants. One home, shared by the request builder and the parser, so
// a property key can never drift between the two.
//
// Re-implemented from scripts/spikes/lib/constants.ts, never imported. Spike code is a
// reference, not a dependency.
import type { SessionSourceKind } from "@growthmind/shared";

/** The one implementation this sprint ships. Compile-pinned to the shared Zod union so
 * a typo here is a compile error, not a runtime one. */
export const POSTHOG_SOURCE_KIND = "posthog" satisfies SessionSourceKind;

/**
 * Drops every trailing slash from a customer-supplied host. A host pasted as
 * `https://eu.posthog.com/` would otherwise produce `…com//api/projects/…`, which the
 * server treats as a different path. A 404 the customer would read as "wrong project
 * number" rather than "stray slash".
 *
 * Private on purpose: the spike exports its own trimmer and this one is re-written
 * rather than re-exported, so the adapter carries no dependency on `scripts/`.
 */
function trimHost(host: string): string {
  return host.replace(/\/+$/, "");
}

/** Events list read API. Bearer personal key.
 *
 *  (security audit): `sourceProjectId` is customer-supplied (`ConnectInput
 * .sourceProjectId`, `@growthmind/shared`) and interpolated straight into a URL path
 * segment. Unescaped, a value containing `/`, `..`, `?`, or `#` could redirect the
 * request to a different path on the same, already host-guard-validated origin (a
 * path-injection variant of the same class of bug host-guard.ts closes for the host
 * itself), rather than the `/events` endpoint under the customer's own project.
 * `encodeURIComponent` is applied here, at the one place both this builder and
 * `personsUrl` below produce a url, so every caller gets it for free. */
export function eventsUrl(host: string, sourceProjectId: string): string {
  return `${trimHost(host)}/api/projects/${encodeURIComponent(sourceProjectId)}/events`;
}

/** Persons read API, the second, budgeted call identity resolution falls back to (row
 * 6: `person` is null on every event, so email is unreachable from the events list).
 * See `eventsUrl` above for why `sourceProjectId` is percent-encoded. */
export function personsUrl(host: string, sourceProjectId: string): string {
  return `${trimHost(host)}/api/projects/${encodeURIComponent(sourceProjectId)}/persons`;
}

/**
 * PostHog property keys, in one place. The request builder and the parser both read
 * from here. A key typed twice is a key that drifts once. Every one of these is SDK-set
 * and may be absent (sec-a/B/C): PostHog does not derive them server-side, so every
 * consumer must treat them as optional.
 */
export const PH_PROP = {
  /** Identify-shaped events carry the email here (row 6). */
  SET: "$set",
  /** Sec-a: SDK-set, may be absent. No server-side derivation exists. */
  RAW_USER_AGENT: "$raw_user_agent",
  /** Sec-b: the path alone. The preferred surface input. */
  PATHNAME: "$pathname",
  /** Sec-b: the full url including the query string. Normalised before use, never
   * stored raw, one utm parameter would fork the surface. */
  CURRENT_URL: "$current_url",
  /** Sec-c: SDK-set, optional. posthog-js sets it; a server-side SDK may not. */
  SESSION_ID: "$session_id",
} as const;

// Tuning constants. Every one is a stated, changeable default with its reasoning beside
// it, never an unexplained number.

/**
 * Rows requested per page. `limit` is pinned honoured to at least 220 (`limit=1000` and
 * `limit=10000` both returned all 220 rows the probe project held); a ceiling above 220
 * was not testable, so this sits under the proven floor with headroom.
 */
export const PAGE_LIMIT = 200;

/** The pinned floor `PAGE_LIMIT` must stay at or below. A test asserts it. */
export const PINNED_PAGE_LIMIT_FLOOR = 220;

/**
 * At most 5,000 events per invocation. Bounds run wall-clock and memory. Hitting it is
 * not a truncation: the walk reports `contiguous: false` with a resume cursor and the
 * watermark does not move.
 */
export const MAX_PAGES_PER_RUN = 25;

/**
 * 15 minutes. Sized against client clock skew plus SDK buffering. Explicitly not
 * against decision 0001's ~24 s ingestion figure, which bounds PostHog's own pipeline
 * while the watermark rests on client-declared event time that decision 0001 does not
 * bound at all. Covers a page left open with a pending flush, an offline queue
 * draining, and a few minutes of clock drift, while bounding the re-queried volume
 * (absorbed by the dedup index, never double-counted).
 *
 * It does not make the walk complete. Nothing can, see.
 */
export const OVERLAP_WINDOW_SECONDS = 900;

/**
 * Persons lookups per poll run, per connection. Worst case is 50 extra requests per
 * run, not one per new visitor: identities are looked up in deterministic first-seen
 * order behind a run-lifetime cache, so budget exhaustion is reproducible in a test
 * rather than random.
 */
export const IDENTITY_LOOKUP_BUDGET = 50;

/**
 * Per endpoint, per run. On give-up the run terminates `failed` with `rate_limited`.
 * There is no unbounded retry loop anywhere in this package, and a grep test asserts
 * it.
 */
export const MAX_RATE_LIMIT_ATTEMPTS = 5;

/**
 * Per-request wall-clock ceiling (audit ). The run budget is only checked between
 * passes, so without this a host that accepts the connection and then never answers
 * hangs the poll for as long as the runtime allows. Generous enough for a slow page
 * over a cold connection; short enough that a stuck endpoint costs one cron tick rather
 * than a worker.
 */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Ceiling on a single response body (audit ). `MAX_PAGES_PER_RUN` bounds how many
 * requests a hostile host can serve, not how large each one is, 25 unbounded bodies is
 * an oom, not a rate limit. A legitimate events page at `EVENTS_PAGE_LIMIT` is orders
 * of magnitude under this.
 */
export const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

/**
 * Ceiling on stream chunks per response. The byte cap alone is not a bound: a hostile
 * host can emit endless zero-length chunks and never trip it. At a realistic 16 KiB per
 * chunk this is ~64 MiB of headroom over `MAX_RESPONSE_BYTES`, so a legitimate body can
 * never reach it.
 */
export const MAX_RESPONSE_CHUNKS = 4096;

/** First exponential step, doubling per attempt. */
export const BASE_DELAY_MS = 1000;

/** Ceiling on the exponential branch. A minute is long enough to clear an ordinary
 * throttle and short enough that a cron tick is not wasted. */
export const MAX_BACKOFF_MS = 60_000;

/**
 * Ceiling on an honoured `Retry-After`. The header is the server's instruction and we
 * never retry earlier than it, but a hostile or buggy value must never park a worker
 * job for hours.
 */
export const RETRY_AFTER_CAP_MS = 120_000;

/** Additive-upward jitter on the `Retry-After` branch, so many connections do not all
 * resume on the same second while none resumes early. */
export const JITTER_SPREAD_MS = 1000;
