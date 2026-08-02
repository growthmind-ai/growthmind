import { expectedLagStatement } from "../session-source/messages";
import type { ExpectedLag } from "./types";

export const POSTHOG_P90_RETRIEVAL_SECONDS = 25;

export const POSTHOG_MAX_RETRIEVAL_SECONDS = 220;

export function describeExpectedLag(input: { pollIntervalSeconds: number }): ExpectedLag {
  const pollIntervalSeconds = Math.max(0, Math.round(input.pollIntervalSeconds));
  const typicalSeconds = pollIntervalSeconds + POSTHOG_P90_RETRIEVAL_SECONDS;
  const worstCaseSeconds = pollIntervalSeconds + POSTHOG_MAX_RETRIEVAL_SECONDS;

  return {
    typicalSeconds,
    worstCaseSeconds,

    statement: expectedLagStatement({ typicalSeconds, worstCaseSeconds }),
  };
}
