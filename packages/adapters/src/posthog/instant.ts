// Timestamp formatting for PostHog's `after` / `before` parameters
// (O-003 D-6g/h, Addendum A ROW 2 / ROW 4).
//
// THE HAZARD THIS FILE EXISTS FOR: a malformed time value returns HTTP 200
// with an empty result set — indistinguishable from a quiet project. A typo'd
// watermark therefore reads as "no new events" forever, silently. So every
// value that reaches the wire comes from ONE tested formatter and is checked
// against its own pattern first; a failure is a NAMED `misconfigured` failure
// and a `failed` run, never a "caught up" (F-10).

/**
 * `YYYY-MM-DDTHH:mm:ss.sss+00:00` — an EXPLICIT offset, never a naive string
 * and never a `Z` suffix. A naive string is parsed as UTC *and truncated to
 * whole seconds*, which measurably changed a result set (8 rows instead of 7).
 */
export const POSTHOG_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+00:00$/;

/** Formats an instant into the wire form above. Its own output is validated
 * against `POSTHOG_INSTANT_PATTERN` before it can reach a request. */
export function formatPostHogInstant(value: Date): string {
  const epochMs = value.getTime();
  if (!Number.isFinite(epochMs)) {
    // An Invalid Date must never reach the wire: it would serialise to
    // something the API answers with 200 + zero rows, which reads as
    // "caught up" forever.
    throw new RangeError("formatPostHogInstant received an unusable instant");
  }

  // `toISOString` already emits UTC with millisecond precision; only the
  // suffix differs from what the API echoes. Swapping `Z` for the explicit
  // offset is the whole transformation — nothing here re-implements calendar
  // arithmetic, so there is no second formatter to drift.
  const formatted = `${value.toISOString().slice(0, -1)}+00:00`;

  // The output is gated by its own pattern BEFORE it can reach a request, so
  // an out-of-range year (which `toISOString` renders in the expanded
  // `+275760-…` form) is a named failure rather than a silent empty page.
  assertPostHogInstant(formatted);
  return formatted;
}

/**
 * Throws a `RangeError` when `value` does not match
 * `POSTHOG_INSTANT_PATTERN`. Call sites catch it and map it to a
 * `misconfigured` failure — the throw never escapes the adapter, and an
 * empty page is never mistaken for "caught up".
 */
export function assertPostHogInstant(value: string): void {
  if (!POSTHOG_INSTANT_PATTERN.test(value)) {
    // The offending value is deliberately NOT interpolated: this string can
    // become a stored reason, and a watermark is not a secret but the habit of
    // echoing inputs into reasons is how one eventually leaks.
    throw new RangeError("A time value did not match the shape the analytics API accepts");
  }
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
export function parsePostHogInstant(value: string): Date | null {
  if (value.trim() === "") {
    // `Date.parse("")` is NaN anyway; the explicit branch documents that an
    // empty watermark is a caller's bug, not an instant at the epoch.
    return null;
  }
  const epochMs = Date.parse(value);
  if (Number.isNaN(epochMs)) {
    return null;
  }
  return new Date(epochMs);
}
