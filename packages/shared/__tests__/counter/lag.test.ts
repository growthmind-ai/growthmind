// item 27, the counter's freshness statement.
//
// No overlap window can make a poll on client-declared event time complete (Addendum a
// row 4: there is no ingestion-time field on the events endpoint by any route), so the
// product states a measurement and never claims freshness it cannot deliver. The word
// "live" appears in no string this sprint produces.
import { describe, expect, test } from "bun:test";

import {
  POSTHOG_MAX_RETRIEVAL_SECONDS,
  POSTHOG_P90_RETRIEVAL_SECONDS,
  describeExpectedLag,
} from "../../src/counter/lag";
import { expectedLagSchema } from "../../src/counter/types";
import { expectedLagStatement } from "../../src/session-source/messages";

/** Word-boundary, so "delivered" is fine and "live" is not. */
const LIVE_CLAIM = /\blive\b/i;

describe("describeExpectedLag", () => {
  // Item 27
  test("states measurement and never uses the word 'live'", () => {
    const lag = describeExpectedLag({ pollIntervalSeconds: 60 });

    expect(lag.statement).not.toMatch(LIVE_CLAIM);
    expect(lag.statement.length).toBeGreaterThan(0);

    // One home for copy: the statement is the shared builder's output, not a second
    // string that could drift out of the plain-English audit.
    expect(lag.statement).toBe(
      expectedLagStatement({
        typicalSeconds: lag.typicalSeconds,
        worstCaseSeconds: lag.worstCaseSeconds,
      }),
    );

    // Also true for the accelerated onboarding cadence, so the assertion is about the
    // function rather than one memorised sentence.
    expect(describeExpectedLag({ pollIntervalSeconds: 15 }).statement).not.toMatch(LIVE_CLAIM);
  });

  test("derives both figures from the poll interval plus the measured retrieval lag", () => {
    const lag = describeExpectedLag({ pollIntervalSeconds: 60 });

    expect(lag.typicalSeconds).toBe(60 + POSTHOG_P90_RETRIEVAL_SECONDS);
    expect(lag.worstCaseSeconds).toBe(60 + POSTHOG_MAX_RETRIEVAL_SECONDS);

    // A shorter interval genuinely moves the number. The figures are computed from the
    // connection's own cadence, not a hardcoded pair.
    const fast = describeExpectedLag({ pollIntervalSeconds: 15 });
    expect(fast.typicalSeconds).toBe(15 + POSTHOG_P90_RETRIEVAL_SECONDS);
    expect(fast.worstCaseSeconds).toBe(15 + POSTHOG_MAX_RETRIEVAL_SECONDS);
    expect(fast.typicalSeconds).toBeLessThan(lag.typicalSeconds);
  });

  test("the worst case is never presented as better than the typical case", () => {
    for (const pollIntervalSeconds of [15, 60, 300]) {
      const lag = describeExpectedLag({ pollIntervalSeconds });
      expect(lag.worstCaseSeconds).toBeGreaterThan(lag.typicalSeconds);
      // Parses as the shape the counter DTO embeds, so cannot receive a half-built
      // object.
      expect(expectedLagSchema.parse(lag)).toEqual(lag);
    }
  });
});
