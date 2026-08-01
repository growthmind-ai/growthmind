// Timestamp formatting for PostHog's `after` / `before` parameters (Addendum A row
// 2 / row 4).
//
// The hazard this file exists for: a malformed time value returns HTTP 200 with an
// empty result set. Indistinguishable from a quiet project. A typo'd watermark
// therefore reads as "no new events" forever, silently. So every value that reaches the
// wire comes from one tested formatter and is checked against its own pattern first; a
// failure is a named `misconfigured` failure and a `failed` run, never a "caught up"
// .

/**
 * `YYYY-MM-DDTHH:mm:ss.sss+00:00`, an explicit offset, never a naive string and never a
 * `Z` suffix. A naive string is parsed as UTC *and truncated to whole seconds*, which
 * measurably changed a result set (8 rows instead of 7).
 */
export const POSTHOG_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+00:00$/;

/** Formats an instant into the wire form above. Its own output is validated against
 * `POSTHOG_INSTANT_PATTERN` before it can reach a request. */
export function formatPostHogInstant(value: Date): string {
  const epochMs = value.getTime();
  if (!Number.isFinite(epochMs)) {
    // An Invalid Date must never reach the wire: it would serialise to something the
    // API answers with 200 + zero rows, which reads as "caught up" forever.
    throw new RangeError("formatPostHogInstant received an unusable instant");
  }

  // `toISOString` already emits UTC with millisecond precision; only the suffix differs
  // from what the API echoes. Swapping `Z` for the explicit offset is the whole
  // transformation. Nothing here re-implements calendar arithmetic, so there is no
  // second formatter to drift.
  const formatted = `${value.toISOString().slice(0, -1)}+00:00`;

  // The output is gated by its own pattern before it can reach a request, so an
  // out-of-range year (which `toISOString` renders in the expanded `+275760-…` form) is
  // a named failure rather than a silent empty page.
  assertPostHogInstant(formatted);
  return formatted;
}

/**
 * Throws a `RangeError` when `value` does not match `POSTHOG_INSTANT_PATTERN`. Call
 * sites catch it and map it to a `misconfigured` failure. The throw never escapes the
 * adapter, and an empty page is never mistaken for "caught up".
 */
export function assertPostHogInstant(value: string): void {
  if (!POSTHOG_INSTANT_PATTERN.test(value)) {
    // The offending value is deliberately not interpolated: this string can become a
    // stored reason, and a watermark is not a secret but the habit of echoing inputs
    // into reasons is how one eventually leaks.
    throw new RangeError("A time value did not match the shape the analytics API accepts");
  }
}

/**
 * Parses the api's own form, `…891000+00:00`, microsecond precision, with an explicit
 * offset. `Date.parse` handles it; string comparison against `toISOString` output
 * does not, which is why nothing in this adapter
 * string-compares a timestamp.
 *
 * Returns `null` rather than an Invalid Date, so an unparseable value is a value the
 * caller must handle rather than a `NaN` that propagates.
 *
 * The raw microsecond string is deliberately not preserved: dedup keys on PostHog's
 * `id`, and the watermark carries a 15-minute overlap, so microseconds are load-bearing
 * nowhere.
 */
export function parsePostHogInstant(value: string): Date | null {
  if (value.trim() === "") {
    // `Date.parse` is NaN anyway; the explicit branch documents that an empty
    // watermark is a caller's bug, not an instant at the epoch.
    return null;
  }
  const epochMs = Date.parse(value);
  if (Number.isNaN(epochMs)) {
    return null;
  }
  return new Date(epochMs);
}
