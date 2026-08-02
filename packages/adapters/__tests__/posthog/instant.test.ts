import { describe, expect, test } from "bun:test";

import {
  POSTHOG_INSTANT_PATTERN,
  assertPostHogInstant,
  formatPostHogInstant,
  parsePostHogInstant,
} from "../../src/posthog/instant";

describe("formatPostHogInstant", () => {
  test("emits an explicit +00:00 offset and never a naive string", () => {
    const formatted = formatPostHogInstant(new Date("2026-07-30T17:57:49.891Z"));

    expect(formatted).toBe("2026-07-30T17:57:49.891+00:00");

    expect(formatted.endsWith("Z")).toBe(false);
    expect(formatted).toContain("+00:00");
  });

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

      expect(() => assertPostHogInstant(formatted)).not.toThrow();
    }

    expect(() => assertPostHogInstant("2026-07-30T17:57:49")).toThrow(RangeError);
    expect(() => assertPostHogInstant("2026-07-30T17:57:49.891Z")).toThrow(RangeError);
    expect(() => assertPostHogInstant("not-a-date")).toThrow(RangeError);
  });
});

describe("parsePostHogInstant", () => {
  test("parses the API's microsecond +00:00 form and does not string-compare against toISOString", () => {
    const wire = "2026-07-30T17:57:49.891000+00:00";

    const parsed = parsePostHogInstant(wire);
    expect(parsed).toBeInstanceOf(Date);
    expect(parsed?.getTime()).toBe(Date.parse("2026-07-30T17:57:49.891Z"));

    expect(parsed?.toISOString()).toBe("2026-07-30T17:57:49.891Z");
    expect(parsed?.toISOString()).not.toBe(wire);

    expect(parsePostHogInstant("not-a-date")).toBeNull();
    expect(parsePostHogInstant("")).toBeNull();
  });
});
