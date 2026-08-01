// items 24–25, session grouping (F-12 / churn).
//
// F-12's fail direction: toward one session per event for unattributed events. Merging
// them would fabricate a giant fake session and corrupt every downstream funnel;
// splitting them costs a few extra rows.
//
// The 30-minute bucket is fixed, not a sliding inactivity gap: a sliding window shifts
// as late events arrive, forking the key of a session already on record. Addendum A row
// 4 pinned that late and backdated events are ordinary here, so arrival order must not
// be able to change a key.
import { describe, expect, test } from "bun:test";

import {
  SESSION_BUCKET_MS,
  SESSION_GROUPING_VERSION,
  deriveSessionKey,
} from "../../src/sessions/grouping";
import type { SessionKeyInput } from "../../src/sessions/grouping";

const PH_SESSION = "s0-ph-session-0001";
const IDENTITY = "s0-distinct-0001";

/** 17:05Z sits mid-bucket; 17:29:59.999Z and 17:30:00.000Z straddle one. */
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
  // Item 24
  test("prefers $session_id, falls back to a deterministic 30-minute bucket, and gives unattributed events their own session", () => {
    // 1. PostHog's own session id wins whenever the customer's SDK set one —
    //  and it wins even when we could have derived a key ourselves.
    expect(deriveSessionKey(input({ postHogSessionId: PH_SESSION, identityKey: IDENTITY }))).toBe(
      `ph:${PH_SESSION}`,
    );

    // 2. No $session_id, but an identity: a fixed bucket, deterministic
    //  regardless of when the event actually reached us.
    expect(deriveSessionKey(input({ identityKey: IDENTITY }))).toBe(
      `gm:${IDENTITY}:${bucketOf(MID_BUCKET)}`,
    );
    // Two events of one identity inside one bucket are one session...
    expect(deriveSessionKey(input({ identityKey: IDENTITY, occurredAt: LATE_SAME_BUCKET }))).toBe(
      deriveSessionKey(input({ identityKey: IDENTITY, occurredAt: MID_BUCKET })),
    );
    // ...and the boundary splits, which is the named, accepted trade-off.
    expect(deriveSessionKey(input({ identityKey: IDENTITY, occurredAt: BUCKET_END }))).not.toBe(
      deriveSessionKey(input({ identityKey: IDENTITY, occurredAt: NEXT_BUCKET_START })),
    );

    // 3. F-12: neither signal ⇒ one session per event, never a merge.
    const anonymous = ["s0-event-a", "s0-event-b", "s0-event-c"].map((sourceEventId) =>
      deriveSessionKey(input({ sourceEventId, occurredAt: MID_BUCKET })),
    );
    expect(anonymous).toEqual(["gm:anon:s0-event-a", "gm:anon:s0-event-b", "gm:anon:s0-event-c"]);
    expect(new Set(anonymous).size).toBe(3);
  });

  test("an empty $session_id or identity key is treated as absent, not as a key", () => {
    // An empty string is a shape PostHog can emit (sec-c: $session_id is SDK-set).
    // Keying on it would merge every such event into `ph:`.
    expect(deriveSessionKey(input({ postHogSessionId: "", identityKey: IDENTITY }))).toBe(
      `gm:${IDENTITY}:${bucketOf(MID_BUCKET)}`,
    );
    expect(deriveSessionKey(input({ postHogSessionId: "", identityKey: "" }))).toBe(
      "gm:anon:s0-event-0001",
    );
  });

  // Item 25, churn.
  test("the key for the same identity and instant is byte-identical across two derivations and across arrival orders", () => {
    const first = deriveSessionKey(input({ identityKey: IDENTITY, sourceEventId: "s0-event-1" }));
    const second = deriveSessionKey(input({ identityKey: IDENTITY, sourceEventId: "s0-event-1" }));
    expect(second).toBe(first);

    // A different event id must not change the key once an identity exists. Otherwise
    // every event would be its own session.
    expect(deriveSessionKey(input({ identityKey: IDENTITY, sourceEventId: "s0-event-2" }))).toBe(
      first,
    );

    // Arrival order is not an input. Addendum A row 4 pinned that a backdated event
    // lands behind the newest-first walk, so the same three events read in either
    // direction must produce the same three keys.
    const events: SessionKeyInput[] = [
      input({ identityKey: IDENTITY, occurredAt: MID_BUCKET, sourceEventId: "s0-event-1" }),
      input({ identityKey: IDENTITY, occurredAt: LATE_SAME_BUCKET, sourceEventId: "s0-event-2" }),
      input({ identityKey: IDENTITY, occurredAt: NEXT_BUCKET_START, sourceEventId: "s0-event-3" }),
    ];
    const forwards = events.map(deriveSessionKey);
    const backwards = events.toReversed().map(deriveSessionKey);
    expect(backwards).toEqual(forwards.toReversed());

    // And a re-derivation from an equal-but-not-identical Date object is the same
    // string. The key must depend on the instant, not on object identity.
    expect(
      deriveSessionKey(
        input({ identityKey: IDENTITY, occurredAt: new Date(MID_BUCKET.getTime()) }),
      ),
    ).toBe(first);
  });

  test("SESSION_BUCKET_MS is 30 minutes and the rules are versioned", () => {
    // Persisted per session, so a stamp's provenance is readable from the row rather
    // than inferred from a deploy date.
    expect(SESSION_BUCKET_MS).toBe(30 * 60_000);
    expect(SESSION_GROUPING_VERSION).toBe(1);
  });
});
