// Timestamp formatting for PostHog's `after` / `before` parameters
// (O-003 D-6g/h, Addendum A ROW 2 / ROW 4).
//
// THE HAZARD THIS FILE EXISTS FOR: a malformed time value returns HTTP 200
// with an empty result set — indistinguishable from a quiet project. A typo'd
// watermark therefore reads as "no new events" forever, silently. So every
// value that reaches the wire comes from ONE tested formatter and is checked
// against its own pattern first; a failure is a NAMED `misconfigured` failure
// and a `failed` run, never a "caught up" (F-10).
//
// TYPED STUB (O-003 scaffold): the pattern is real; the bodies throw.

/**
 * `YYYY-MM-DDTHH:mm:ss.sss+00:00` — an EXPLICIT offset, never a naive string
 * and never a `Z` suffix. A naive string is parsed as UTC *and truncated to
 * whole seconds*, which measurably changed a result set (8 rows instead of 7).
 */
export const POSTHOG_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+00:00$/;

/** Formats an instant into the wire form above. Its own output is validated
 * against `POSTHOG_INSTANT_PATTERN` before it can reach a request. */
export function formatPostHogInstant(_value: Date): string {
  throw new Error("TYPED STUB (O-003 scaffold): formatPostHogInstant");
}

/**
 * Throws a `RangeError` when `value` does not match
 * `POSTHOG_INSTANT_PATTERN`. Call sites catch it and map it to a
 * `misconfigured` failure — the throw never escapes the adapter, and an
 * empty page is never mistaken for "caught up".
 */
export function assertPostHogInstant(_value: string): void {
  throw new Error("TYPED STUB (O-003 scaffold): assertPostHogInstant");
}

/**
 * Parses the API's own form — `…891000+00:00`, MICROSECOND precision, with an
 * explicit offset. `Date.parse` handles it; string comparison against
 * `toISOString()` output does NOT (`…891000+00:00` ≠ `…891Z`), which is why
 * nothing in this adapter string-compares a timestamp.
 *
 * Returns `null` rather than an Invalid Date, so an unparseable value is a
 * value the caller must handle rather than a `NaN` that propagates.
 *
 * The raw microsecond string is deliberately not preserved: dedup keys on
 * PostHog's `id`, and the watermark carries a 15-minute overlap, so
 * microseconds are load-bearing nowhere.
 */
export function parsePostHogInstant(_value: string): Date | null {
  throw new Error("TYPED STUB (O-003 scaffold): parsePostHogInstant");
}
