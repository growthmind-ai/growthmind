import type { ReplayRecordingSummary } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { parseEventsPage, parseRecordingsPage } from "../../src/rrweb/parse";

const AD_HOST = "https://replay.ad-fake.invalid";
const AD_OTHER_ORIGIN_HOST = "https://evil.ad-fake.invalid";

const AD_RECORDING_1 = "ad-recording-1";
const AD_RECORDING_2 = "ad-recording-2";

describe("parseRecordingsPage", () => {
  test("reads items from a bare array envelope", () => {
    const parsed = parseRecordingsPage([{ id: AD_RECORDING_1 }], AD_HOST);
    expect(
      parsed.recordings.map((recording: ReplayRecordingSummary) => recording.recordingId),
    ).toEqual([AD_RECORDING_1]);
    expect(parsed.droppedMalformed).toBe(0);
  });

  test.each(["recordings", "results", "data", "items"] as const)(
    "reads items from a { %s: [...] } envelope",
    (key) => {
      const parsed = parseRecordingsPage({ [key]: [{ id: AD_RECORDING_1 }] }, AD_HOST);
      expect(
        parsed.recordings.map((recording: ReplayRecordingSummary) => recording.recordingId),
      ).toEqual([AD_RECORDING_1]);
      expect(parsed.droppedMalformed).toBe(0);
    },
  );

  test("an empty array envelope yields zero recordings and zero drops", () => {
    const parsed = parseRecordingsPage([], AD_HOST);
    expect(parsed.recordings).toEqual([]);
    expect(parsed.droppedMalformed).toBe(0);
  });

  test("an unknown envelope shape yields zero items and counts one malformed page", () => {
    const parsed = parseRecordingsPage({ unexpectedKey: [{ id: AD_RECORDING_1 }] }, AD_HOST);
    expect(parsed.recordings).toEqual([]);
    expect(parsed.droppedMalformed).toBe(1);
  });

  test.each([
    ["id", { id: "ad-from-id" }, "ad-from-id"],
    ["recordingId", { recordingId: "ad-from-recordingId" }, "ad-from-recordingId"],
    ["recording_id", { recording_id: "ad-from-recording_id" }, "ad-from-recording_id"],
    ["a numeric id, coerced to a string", { id: 42 }, "42"],
    ["a numeric recording_id, coerced to a string", { recording_id: 7 }, "7"],
  ])("reads the recording id from %s", (_label, item, expectedId) => {
    const parsed = parseRecordingsPage([item], AD_HOST);
    expect(parsed.recordings).toHaveLength(1);
    expect(parsed.recordings[0]?.recordingId).toBe(expectedId);
  });

  test("drops and counts an item that carries no id variant at all", () => {
    const parsed = parseRecordingsPage(
      [{ startedAt: "2026-07-30T17:00:00.000Z" }, { id: AD_RECORDING_2 }],
      AD_HOST,
    );
    expect(
      parsed.recordings.map((recording: ReplayRecordingSummary) => recording.recordingId),
    ).toEqual([AD_RECORDING_2]);
    expect(parsed.droppedMalformed).toBe(1);
  });

  test("never throws on a non-object item in the page", () => {
    const parsed = parseRecordingsPage([null, "ad-not-an-object", { id: AD_RECORDING_1 }], AD_HOST);
    expect(
      parsed.recordings.map((recording: ReplayRecordingSummary) => recording.recordingId),
    ).toEqual([AD_RECORDING_1]);
    expect(parsed.droppedMalformed).toBe(2);
  });

  test.each([
    ["startedAt", { id: AD_RECORDING_1, startedAt: "2026-07-30T17:00:00.000Z" }],
    ["started_at", { id: AD_RECORDING_1, started_at: "2026-07-30T17:00:00.000Z" }],
    ["createdAt", { id: AD_RECORDING_1, createdAt: "2026-07-30T17:00:00.000Z" }],
    ["created_at", { id: AD_RECORDING_1, created_at: "2026-07-30T17:00:00.000Z" }],
  ])("reads startedAt from %s", (_label, item) => {
    const parsed = parseRecordingsPage([item], AD_HOST);
    expect(parsed.recordings[0]?.startedAt).toEqual(new Date("2026-07-30T17:00:00.000Z"));
  });

  test.each([
    ["endedAt", { id: AD_RECORDING_1, endedAt: "2026-07-30T18:00:00.000Z" }],
    ["lastActivityAt", { id: AD_RECORDING_1, lastActivityAt: "2026-07-30T18:00:00.000Z" }],
    ["updated_at", { id: AD_RECORDING_1, updated_at: "2026-07-30T18:00:00.000Z" }],
  ])("reads lastActivityAt from %s", (_label, item) => {
    const parsed = parseRecordingsPage([item], AD_HOST);
    expect(parsed.recordings[0]?.lastActivityAt).toEqual(new Date("2026-07-30T18:00:00.000Z"));
  });

  test("a summary with no timestamps at all still yields an item, with nulls instead of a drop", () => {
    const parsed = parseRecordingsPage([{ id: AD_RECORDING_1 }], AD_HOST);
    expect(parsed.recordings).toHaveLength(1);
    expect(parsed.recordings[0]?.startedAt).toBeNull();
    expect(parsed.recordings[0]?.lastActivityAt).toBeNull();
    expect(parsed.droppedMalformed).toBe(0);
  });

  test("an unparseable timestamp value is null rather than dropping the item", () => {
    const parsed = parseRecordingsPage(
      [{ id: AD_RECORDING_1, startedAt: "not-a-date", endedAt: "also-not-a-date" }],
      AD_HOST,
    );
    expect(parsed.recordings).toHaveLength(1);
    expect(parsed.recordings[0]?.startedAt).toBeNull();
    expect(parsed.recordings[0]?.lastActivityAt).toBeNull();
    expect(parsed.droppedMalformed).toBe(0);
  });

  test.each([
    ["next", { next: `${AD_HOST}/api/recordings?cursor=1` }],
    ["nextCursor", { nextCursor: `${AD_HOST}/api/recordings?cursor=2` }],
    ["next_cursor", { next_cursor: `${AD_HOST}/api/recordings?cursor=3` }],
  ])("reads the pagination cursor from %s", (_label, envelope) => {
    const body = { recordings: [], ...envelope };
    const cursor = Object.values(envelope)[0];
    expect(parseRecordingsPage(body, AD_HOST).next).toBe(cursor as string);
  });

  test("returns next: null when no cursor key is present", () => {
    expect(parseRecordingsPage({ recordings: [] }, AD_HOST).next).toBeNull();
  });

  test("a cursor on a different origin than host is treated as absent and counted malformed", () => {
    const parsed = parseRecordingsPage(
      {
        recordings: [{ id: AD_RECORDING_1 }],
        next: `${AD_OTHER_ORIGIN_HOST}/api/recordings?cursor=1`,
      },
      AD_HOST,
    );
    expect(parsed.next).toBeNull();
    expect(parsed.droppedMalformed).toBe(1);
    expect(
      parsed.recordings.map((recording: ReplayRecordingSummary) => recording.recordingId),
    ).toEqual([AD_RECORDING_1]);
  });
});

describe("parseEventsPage", () => {
  const validEvent = { type: 3, timestamp: 1722770000000, data: { source: 0 } };

  test("reads items from a bare array envelope", () => {
    const parsed = parseEventsPage([validEvent], AD_HOST);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.droppedMalformed).toBe(0);
  });

  test.each(["events", "results", "data"] as const)(
    "reads items from a { %s: [...] } envelope",
    (key) => {
      const parsed = parseEventsPage({ [key]: [validEvent] }, AD_HOST);
      expect(parsed.events).toHaveLength(1);
      expect(parsed.droppedMalformed).toBe(0);
    },
  );

  test("a valid event keeps its type, timestamp, and data", () => {
    const parsed = parseEventsPage([validEvent], AD_HOST);
    expect(parsed.events[0]).toEqual(validEvent);
  });

  test("type: 0 is a valid boundary, not a falsy rejection", () => {
    const parsed = parseEventsPage([{ type: 0, timestamp: 1, data: {} }], AD_HOST);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.droppedMalformed).toBe(0);
  });

  test.each([
    ["a negative type", { type: -1, timestamp: 1722770000000, data: {} }],
    ["a non-integer type", { type: 1.5, timestamp: 1722770000000, data: {} }],
    ["a zero timestamp", { type: 3, timestamp: 0, data: {} }],
    ["a negative timestamp", { type: 3, timestamp: -1, data: {} }],
    ["a NaN timestamp", { type: 3, timestamp: Number.NaN, data: {} }],
    ["an Infinite timestamp", { type: 3, timestamp: Number.POSITIVE_INFINITY, data: {} }],
    ["a missing data key", { type: 3, timestamp: 1722770000000 }],
    ["a missing type", { timestamp: 1722770000000, data: {} }],
    ["a missing timestamp", { type: 3, data: {} }],
    ["a non-object item", "ad-not-an-event"],
    ["a null item", null],
  ])("drops and counts %s without throwing", (_label, item) => {
    expect(() => parseEventsPage([item], AD_HOST)).not.toThrow();
    const parsed = parseEventsPage([item], AD_HOST);
    expect(parsed.events).toEqual([]);
    expect(parsed.droppedMalformed).toBe(1);
  });

  test("data: null is a present key, not a drop", () => {
    const parsed = parseEventsPage([{ type: 3, timestamp: 1722770000000, data: null }], AD_HOST);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.droppedMalformed).toBe(0);
  });

  test("an empty page yields zero events and zero drops", () => {
    const parsed = parseEventsPage([], AD_HOST);
    expect(parsed.events).toEqual([]);
    expect(parsed.droppedMalformed).toBe(0);
  });

  test("a mixed page of 2 valid and 3 malformed items yields 2 events and droppedMalformed 3", () => {
    const parsed = parseEventsPage(
      [
        validEvent,
        { type: -1, timestamp: 1722770000000, data: {} },
        { type: 3, timestamp: 1722770001000, data: { source: 1 } },
        "ad-garbage",
        { type: 3 },
      ],
      AD_HOST,
    );
    expect(parsed.events).toHaveLength(2);
    expect(parsed.droppedMalformed).toBe(3);
  });

  test("returns next: null when no cursor key is present", () => {
    expect(parseEventsPage([validEvent], AD_HOST).next).toBeNull();
  });
});
