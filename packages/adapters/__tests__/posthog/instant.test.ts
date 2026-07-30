// ADD §9 items 31–33 — the one tested formatter that stands between the
// watermark and Addendum A ROW 2's silent-empty hazard: a malformed time value
// returns HTTP 200 with an empty result set, so a typo'd watermark reads as
// "no new events" forever, with no error anywhere (F-10).
import { describe, expect, test } from "bun:test";

import {
  POSTHOG_INSTANT_PATTERN,
  assertPostHogInstant,
  formatPostHogInstant,
  parsePostHogInstant,
} from "../../src/posthog/instant";

describe("formatPostHogInstant", () => {
  // Item 31 — ROW 2 / F-10.
  test("emits an explicit +00:00 offset and never a naive string", () => {
    const formatted = formatPostHogInstant(new Date("2026-07-30T17:57:49.891Z"));

    expect(formatted).toBe("2026-07-30T17:57:49.891+00:00");
    // A `Z` suffix is not what the API echoes; a NAIVE string is worse still —
    // it is parsed as UTC and truncated to whole seconds, which measurably
    // changed a result set (8 rows instead of 7).
    expect(formatted.endsWith("Z")).toBe(false);
    expect(formatted).toContain("+00:00");
  });

  // Item 32 — F-10: the output is gated by its own pattern before it can reach
  // a request, so nothing unvalidated ever lands on `after` or `before`.
  test("output satisfies POSTHOG_INSTANT_PATTERN for boundary instants (epoch, ms=0, ms=999)", () => {
    const boundaries: readonly [Date, string][] = [
      [new Date(0), "1970-01-01T00:00:00.000+00:00"],
      [new Date("2026-07-30T00:00:00.000Z"), "2026-07-30T00:00:00.000+00:00"],
      [new Date("2026-07-30T23:59:59.999Z"), "2026-07-30T23:59:59.999+00:00"],
    ];

    for (const [instant, expected] of boundaries) {
      const formatted = formatPostHogInstant(instant);
      expect(formatted).toBe(expected);
      expect(POSTHOG_INSTANT_PATTERN.test(formatted)).toBe(true);
      // The gate accepts its own formatter's output and nothing else.
      expect(() => assertPostHogInstant(formatted)).not.toThrow();
    }

    // The two forms that would silently change or empty a result set.
    expect(() => assertPostHogInstant("2026-07-30T17:57:49")).toThrow(RangeError);
    expect(() => assertPostHogInstant("2026-07-30T17:57:49.891Z")).toThrow(RangeError);
    expect(() => assertPostHogInstant("not-a-date")).toThrow(RangeError);
  });
});

describe("parsePostHogInstant", () => {
  // Item 33 — ROW 4.
  test("parses the API's microsecond +00:00 form and does not string-compare against toISOString", () => {
    const wire = "2026-07-30T17:57:49.891000+00:00";

    const parsed = parsePostHogInstant(wire);
    expect(parsed).toBeInstanceOf(Date);
    expect(parsed?.getTime()).toBe(Date.parse("2026-07-30T17:57:49.891Z"));

    // The proof that nothing in this adapter may string-compare a timestamp:
    // the round-trip is NOT byte-identical to the wire form.
    expect(parsed?.toISOString()).toBe("2026-07-30T17:57:49.891Z");
    expect(parsed?.toISOString()).not.toBe(wire);

    // An unparseable value is a value the caller must handle — never a NaN
    // Date that propagates silently into a request parameter.
    expect(parsePostHogInstant("not-a-date")).toBeNull();
    expect(parsePostHogInstant("")).toBeNull();
  });
});
