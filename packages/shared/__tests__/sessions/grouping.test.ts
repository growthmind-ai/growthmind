import { describe, expect, test } from "bun:test";

import {
  SESSION_BUCKET_MS,
  SESSION_GROUPING_VERSION,
  deriveSessionKey,
  groupSessionsByDomain,
  recordingIdFromSessionKey,
} from "../../src/sessions/grouping";
import type {
  AccountGroup,
  GroupableSessionFact,
  SessionKeyInput,
} from "../../src/sessions/grouping";

const PH_SESSION = "s0-ph-session-0001";
const IDENTITY = "s0-distinct-0001";

const MID_BUCKET = new Date("2026-07-30T17:05:00.000Z");
const LATE_SAME_BUCKET = new Date("2026-07-30T17:20:30.000Z");
const BUCKET_END = new Date("2026-07-30T17:29:59.999Z");
const NEXT_BUCKET_START = new Date("2026-07-30T17:30:00.000Z");

function input(overrides: Partial<SessionKeyInput> = {}): SessionKeyInput {
  return {
    postHogSessionId: null,
    identityKey: null,
    occurredAt: MID_BUCKET,
    sourceEventId: "s0-event-0001",
    ...overrides,
  };
}

function bucketOf(at: Date): number {
  return Math.floor(at.getTime() / SESSION_BUCKET_MS);
}

describe("deriveSessionKey", () => {
  test("prefers $session_id, falls back to a deterministic 30-minute bucket, and gives unattributed events their own session", () => {
    expect(deriveSessionKey(input({ postHogSessionId: PH_SESSION, identityKey: IDENTITY }))).toBe(
      `ph:${PH_SESSION}`,
    );

    expect(deriveSessionKey(input({ identityKey: IDENTITY }))).toBe(
      `gm:${IDENTITY}:${bucketOf(MID_BUCKET)}`,
    );

    expect(deriveSessionKey(input({ identityKey: IDENTITY, occurredAt: LATE_SAME_BUCKET }))).toBe(
      deriveSessionKey(input({ identityKey: IDENTITY, occurredAt: MID_BUCKET })),
    );

    expect(deriveSessionKey(input({ identityKey: IDENTITY, occurredAt: BUCKET_END }))).not.toBe(
      deriveSessionKey(input({ identityKey: IDENTITY, occurredAt: NEXT_BUCKET_START })),
    );

    const anonymous = ["s0-event-a", "s0-event-b", "s0-event-c"].map((sourceEventId) =>
      deriveSessionKey(input({ sourceEventId, occurredAt: MID_BUCKET })),
    );
    expect(anonymous).toEqual(["gm:anon:s0-event-a", "gm:anon:s0-event-b", "gm:anon:s0-event-c"]);
    expect(new Set(anonymous).size).toBe(3);
  });

  test("an empty $session_id or identity key is treated as absent, not as a key", () => {
    expect(deriveSessionKey(input({ postHogSessionId: "", identityKey: IDENTITY }))).toBe(
      `gm:${IDENTITY}:${bucketOf(MID_BUCKET)}`,
    );
    expect(deriveSessionKey(input({ postHogSessionId: "", identityKey: "" }))).toBe(
      "gm:anon:s0-event-0001",
    );
  });

  test("the key for the same identity and instant is byte-identical across two derivations and across arrival orders", () => {
    const first = deriveSessionKey(input({ identityKey: IDENTITY, sourceEventId: "s0-event-1" }));
    const second = deriveSessionKey(input({ identityKey: IDENTITY, sourceEventId: "s0-event-1" }));
    expect(second).toBe(first);

    expect(deriveSessionKey(input({ identityKey: IDENTITY, sourceEventId: "s0-event-2" }))).toBe(
      first,
    );

    const events: SessionKeyInput[] = [
      input({ identityKey: IDENTITY, occurredAt: MID_BUCKET, sourceEventId: "s0-event-1" }),
      input({ identityKey: IDENTITY, occurredAt: LATE_SAME_BUCKET, sourceEventId: "s0-event-2" }),
      input({ identityKey: IDENTITY, occurredAt: NEXT_BUCKET_START, sourceEventId: "s0-event-3" }),
    ];
    const forwards = events.map(deriveSessionKey);
    const backwards = events.toReversed().map(deriveSessionKey);
    expect(backwards).toEqual(forwards.toReversed());

    expect(
      deriveSessionKey(
        input({ identityKey: IDENTITY, occurredAt: new Date(MID_BUCKET.getTime()) }),
      ),
    ).toBe(first);
  });

  test("SESSION_BUCKET_MS is 30 minutes and the rules are versioned", () => {
    expect(SESSION_BUCKET_MS).toBe(30 * 60_000);
    expect(SESSION_GROUPING_VERSION).toBe(1);
  });
});

function fact(
  identityEmailDomain: string,
  startedAt: Date,
  overrides: Partial<GroupableSessionFact> = {},
): GroupableSessionFact {
  return { identityEmailDomain, startedAt, ...overrides };
}

function groupFor(groups: readonly AccountGroup[], domain: string): AccountGroup | undefined {
  return groups.find((group) => group.domain === domain);
}

describe("groupSessionsByDomain", () => {
  test("excludes a free-mail domain and never merges it into another group's count", () => {
    const groups = groupSessionsByDomain([
      fact("acme.example", MID_BUCKET),
      fact("gmail.com", MID_BUCKET),
      fact("gmail.com", LATE_SAME_BUCKET),
      fact("gmail.com", BUCKET_END),
    ]);

    expect(groupFor(groups, "gmail.com")).toBeUndefined();
    expect(groupFor(groups, "acme.example")?.sessionCount).toBe(1);
  });

  test("computes sessionCount and mostRecentSessionAt per domain across multiple sessions for the same domain", () => {
    const groups = groupSessionsByDomain([
      fact("acme.example", MID_BUCKET),
      fact("acme.example", NEXT_BUCKET_START),
      fact("acme.example", LATE_SAME_BUCKET),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.domain).toBe("acme.example");
    expect(groups[0]?.sessionCount).toBe(3);
    expect(groups[0]?.mostRecentSessionAt.getTime()).toBe(NEXT_BUCKET_START.getTime());
  });

  test("sorts groups by mostRecentSessionAt, descending", () => {
    const groups = groupSessionsByDomain([
      fact("early.example", MID_BUCKET),
      fact("latest.example", NEXT_BUCKET_START),
      fact("middle.example", LATE_SAME_BUCKET),
    ]);

    expect(groups.map((group) => group.domain)).toEqual([
      "latest.example",
      "middle.example",
      "early.example",
    ]);
  });

  test("returns an empty array for no sessions", () => {
    expect(groupSessionsByDomain([])).toEqual([]);
  });
});

describe("recordingIdFromSessionKey", () => {
  test('returns the id for a "ph:"-prefixed key', () => {
    expect(recordingIdFromSessionKey("ph:abc123")).toBe("abc123");
  });

  test('returns null for a "gm:"-prefixed key, the shape with no native session id', () => {
    expect(recordingIdFromSessionKey("gm:identity:123")).toBeNull();
  });

  test('returns null for a bare "ph:" key with nothing after the prefix', () => {
    expect(recordingIdFromSessionKey("ph:")).toBeNull();
  });
});
