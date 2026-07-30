// Every cross-boundary literal the PostHog adapter uses (D9): URL builders,
// property keys, and the tuning constants. One home, shared by the request
// builder and the parser, so a property key can never drift between the two.
//
// Re-implemented from scripts/spikes/lib/constants.ts — never imported.
// Spike code is a reference, not a dependency.
//
// TYPED STUB (O-003 scaffold): the constants below are REAL and final; the
// URL builders' signatures are final and their bodies throw.
import type { SessionSourceKind } from "@growthmind/shared";

/** The one implementation this sprint ships. Compile-pinned to the shared
 * Zod union so a typo here is a compile error, not a runtime one. */
export const POSTHOG_SOURCE_KIND = "posthog" satisfies SessionSourceKind;

/** Events list read API. Bearer personal key. */
export function eventsUrl(_host: string, _sourceProjectId: string): string {
  throw new Error("TYPED STUB (O-003 scaffold): eventsUrl");
}

/** Persons read API — the second, budgeted call identity resolution falls
 * back to (ROW 6: `person` is null on every event, so email is unreachable
 * from the events list). */
export function personsUrl(_host: string, _sourceProjectId: string): string {
  throw new Error("TYPED STUB (O-003 scaffold): personsUrl");
}

/**
 * PostHog property keys, in one place. The request builder and the parser
 * both read from here — a key typed twice is a key that drifts once (D9).
 * Every one of these is SDK-set and may be absent (SEC-A/B/C): PostHog does
 * not derive them server-side, so every consumer must treat them as optional.
 */
export const PH_PROP = {
  /** Identify-shaped events carry the email here (ROW 6). */
  SET: "$set",
  /** SEC-A: SDK-set, may be absent. No server-side derivation exists. */
  RAW_USER_AGENT: "$raw_user_agent",
  /** SEC-B: the path alone — the preferred surface input. */
  PATHNAME: "$pathname",
  /** SEC-B: the FULL url including the query string. Normalised before use,
   * never stored raw — one UTM parameter would fork the surface (D12). */
  CURRENT_URL: "$current_url",
  /** SEC-C: SDK-set, optional. posthog-js sets it; a server-side SDK may
   * not. */
  SESSION_ID: "$session_id",
} as const;

// ---------------------------------------------------------------------------
// Tuning constants. Every one is a STATED, CHANGEABLE default with its
// reasoning beside it (FR-25) — never an unexplained number.
// ---------------------------------------------------------------------------

/**
 * Rows requested per page. `limit` is pinned honoured to at least 220
 * (`limit=1000` and `limit=10000` both returned all 220 rows the probe
 * project held); a ceiling above 220 was not testable, so this sits under the
 * proven floor with headroom.
 */
export const PAGE_LIMIT = 200;

/** The pinned floor `PAGE_LIMIT` must stay at or below. A test asserts it. */
export const PINNED_PAGE_LIMIT_FLOOR = 220;

/**
 * At most 5,000 events per invocation. Bounds run wall-clock and memory.
 * Hitting it is NOT a truncation: the walk reports `contiguous: false` with a
 * resume cursor and the watermark does not move (D-6d).
 */
export const MAX_PAGES_PER_RUN = 25;

/**
 * 15 minutes. Sized against CLIENT CLOCK SKEW plus SDK buffering —
 * explicitly not against decision 0001's ~24 s ingestion figure, which bounds
 * PostHog's own pipeline while the watermark rests on client-declared event
 * time that decision 0001 does not bound at all. Covers a page left open with
 * a pending flush, an offline queue draining, and a few minutes of clock
 * drift, while bounding the re-queried volume (absorbed by the dedup index,
 * never double-counted).
 *
 * It does NOT make the walk complete. Nothing can — see D-6f.
 */
export const OVERLAP_WINDOW_SECONDS = 900;

/**
 * Persons lookups per poll run, per connection. Worst case is 50 extra
 * requests per run, NOT one per new visitor: identities are looked up in
 * deterministic first-seen order behind a run-lifetime cache, so budget
 * exhaustion is reproducible in a test rather than random.
 */
export const IDENTITY_LOOKUP_BUDGET = 50;

/**
 * Per endpoint, per run. On give-up the run terminates `failed` with
 * `rate_limited` — there is no unbounded retry loop anywhere in this package,
 * and a grep test asserts it.
 */
export const MAX_RATE_LIMIT_ATTEMPTS = 5;

/** First exponential step, doubling per attempt. */
export const BASE_DELAY_MS = 1000;

/** Ceiling on the exponential branch. A minute is long enough to clear an
 * ordinary throttle and short enough that a cron tick is not wasted. */
export const MAX_BACKOFF_MS = 60_000;

/**
 * Ceiling on an honoured `Retry-After`. The header is the server's
 * instruction and we never retry earlier than it — but a hostile or buggy
 * value must never park a worker job for hours.
 */
export const RETRY_AFTER_CAP_MS = 120_000;

/** Additive-upward jitter on the `Retry-After` branch, so many connections do
 * not all resume on the same second while none resumes early. */
export const JITTER_SPREAD_MS = 1000;
