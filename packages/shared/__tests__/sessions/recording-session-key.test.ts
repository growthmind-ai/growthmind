import { describe, expect, test } from "bun:test";

import type { ReplaySourceKind } from "../../src/replay-source/types";
import * as grouping from "../../src/sessions/grouping";

type RecordingSessionKey = (provider: ReplaySourceKind, recordingId: string) => string | null;

const POSTHOG_RECORDING_ID = "0198c4f2-7a1b-7c3d-9e4f-5a6b7c8d9e0f";

const UNUSED_ON_THE_POSTHOG_BRANCH = new Date("2026-08-05T09:00:00.000Z");

function recordingSessionKey(): RecordingSessionKey {
  const exported = (grouping as unknown as Record<string, unknown>).recordingSessionKey;

  if (typeof exported !== "function") {
    throw new Error(
      "packages/shared/src/sessions/grouping.ts exports no recordingSessionKey. ADD §5.2 " +
        "requires recordingSessionKey(provider, recordingId): string | null beside deriveSessionKey.",
    );
  }

  return exported as RecordingSessionKey;
}

describe("recordingSessionKey — the join key, computed with no database lookup (ADD §5.2)", () => {
  test('should return "ph:<recordingId>" for a posthog recording', () => {
    expect(recordingSessionKey()("posthog", "abc")).toBe("ph:abc");
  });

  test("should produce the same key deriveSessionKey produces for that PostHog session id", () => {
    const derived = grouping.deriveSessionKey({
      postHogSessionId: POSTHOG_RECORDING_ID,
      identityKey: null,
      occurredAt: UNUSED_ON_THE_POSTHOG_BRANCH,
      sourceEventId: POSTHOG_RECORDING_ID,
    });

    expect(recordingSessionKey()("posthog", POSTHOG_RECORDING_ID)).toBe(derived);
  });

  test("should return null for a provider with no session-key mapping", () => {
    expect(recordingSessionKey()("rrweb", "abc")).toBeNull();
  });

  test('should return null for a blank recording id rather than a bare "ph:" key', () => {
    expect(recordingSessionKey()("posthog", "   ")).toBeNull();
  });
});
