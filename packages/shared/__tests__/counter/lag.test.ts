import { describe, expect, test } from "bun:test";

import {
  POSTHOG_MAX_RETRIEVAL_SECONDS,
  POSTHOG_P90_RETRIEVAL_SECONDS,
  describeExpectedLag,
} from "../../src/counter/lag";
import { expectedLagSchema } from "../../src/counter/types";
import { expectedLagStatement } from "../../src/session-source/messages";

const LIVE_CLAIM = /\blive\b/i;

describe("describeExpectedLag", () => {
  test("states measurement and never uses the word 'live'", () => {
    const lag = describeExpectedLag({ pollIntervalSeconds: 60 });

    expect(lag.statement).not.toMatch(LIVE_CLAIM);
    expect(lag.statement.length).toBeGreaterThan(0);

    expect(lag.statement).toBe(
      expectedLagStatement({
        typicalSeconds: lag.typicalSeconds,
        worstCaseSeconds: lag.worstCaseSeconds,
      }),
    );

    expect(describeExpectedLag({ pollIntervalSeconds: 15 }).statement).not.toMatch(LIVE_CLAIM);
  });

  test("derives both figures from the poll interval plus the measured retrieval lag", () => {
    const lag = describeExpectedLag({ pollIntervalSeconds: 60 });

    expect(lag.typicalSeconds).toBe(60 + POSTHOG_P90_RETRIEVAL_SECONDS);
    expect(lag.worstCaseSeconds).toBe(60 + POSTHOG_MAX_RETRIEVAL_SECONDS);

    const fast = describeExpectedLag({ pollIntervalSeconds: 15 });
    expect(fast.typicalSeconds).toBe(15 + POSTHOG_P90_RETRIEVAL_SECONDS);
    expect(fast.worstCaseSeconds).toBe(15 + POSTHOG_MAX_RETRIEVAL_SECONDS);
    expect(fast.typicalSeconds).toBeLessThan(lag.typicalSeconds);
  });

  test("the worst case is never presented as better than the typical case", () => {
    for (const pollIntervalSeconds of [15, 60, 300]) {
      const lag = describeExpectedLag({ pollIntervalSeconds });
      expect(lag.worstCaseSeconds).toBeGreaterThan(lag.typicalSeconds);

      expect(expectedLagSchema.parse(lag)).toEqual(lag);
    }
  });
});
