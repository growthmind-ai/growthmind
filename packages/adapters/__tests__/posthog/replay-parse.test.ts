import { Buffer } from "node:buffer";
import zlib from "node:zlib";

import { describe, expect, test } from "bun:test";

import {
  blobKeyRange,
  parseRecordingsPage,
  parseSnapshotJsonl,
  parseSnapshotSources,
} from "../../src/posthog/replay-parse";

const PROBE_RECORDING_ID = "019fd09b-61cf-77f8-9b0a-79ea0e302420";
const PROBE_WINDOW_ID = "019fd09b-61cf-77f8-9b0a-79eb75e0e426";

describe("parseRecordingsPage", () => {
  test("parses the verbatim probe fixture: id, timestamps, and the useful counters in meta", () => {
    const body = {
      results: [
        {
          id: PROBE_RECORDING_ID,
          distinct_id: "019fc934-fake-distinct-id",
          recording_duration: 177,
          active_seconds: 34,
          inactive_seconds: 142,
          start_time: "2026-08-05T06:27:54.726000Z",
          end_time: "2026-08-05T06:30:51.838000Z",
          click_count: 15,
          keypress_count: 0,
          mouse_activity_count: 125,
          console_error_count: 0,
          start_url: "https://app.growthmind.ai/settings",
          person: { distinct_ids: ["019fc934-fake-distinct-id"] },
          retention_period_days: 30,
        },
      ],
      next: null,
    };

    const parsed = parseRecordingsPage(body);

    expect(parsed.droppedMalformed).toBe(0);
    expect(parsed.recordings).toHaveLength(1);

    const recording = parsed.recordings[0];
    expect(recording?.recordingId).toBe(PROBE_RECORDING_ID);
    expect(recording?.startedAt).toEqual(new Date("2026-08-05T06:27:54.726Z"));
    expect(recording?.lastActivityAt).toEqual(new Date("2026-08-05T06:30:51.838Z"));

    // inactive_seconds is derivable from the two that survive; person and
    // retention_period_days carry identity and storage policy, neither of which
    // this screen reads.
    expect(recording?.meta).toEqual({
      recording_duration: 177,
      active_seconds: 34,
      click_count: 15,
      keypress_count: 0,
      mouse_activity_count: 125,
      console_error_count: 0,
      start_url: "https://app.growthmind.ai/settings",
    });
    expect(recording?.meta.person).toBeUndefined();
    expect(recording?.meta.distinct_id).toBeUndefined();
  });

  test("an empty results array yields zero recordings and zero drops", () => {
    const parsed = parseRecordingsPage({ results: [] });
    expect(parsed.recordings).toEqual([]);
    expect(parsed.droppedMalformed).toBe(0);
    expect(parsed.next).toBeNull();
  });

  test("a body with no results array counts one malformed page, without throwing", () => {
    expect(() => parseRecordingsPage({ unexpected: true })).not.toThrow();
    const parsed = parseRecordingsPage({ unexpected: true });
    expect(parsed.recordings).toEqual([]);
    expect(parsed.droppedMalformed).toBe(1);
  });

  test("never throws on null, a bare array, or a non-object item in results", () => {
    expect(() => parseRecordingsPage(null)).not.toThrow();
    expect(parseRecordingsPage(null).droppedMalformed).toBe(1);

    expect(() => parseRecordingsPage([{ id: "ad-1" }])).not.toThrow();

    const mixed = parseRecordingsPage({ results: [null, "ad-not-an-object", { id: "ad-1" }] });
    expect(mixed.recordings.map((recording) => recording.recordingId)).toEqual(["ad-1"]);
    expect(mixed.droppedMalformed).toBe(2);
  });

  test("drops and counts an item with no id at all", () => {
    const parsed = parseRecordingsPage({
      results: [{ start_time: "2026-08-05T06:27:54.726000Z" }, { id: "ad-2" }],
    });
    expect(parsed.recordings.map((recording) => recording.recordingId)).toEqual(["ad-2"]);
    expect(parsed.droppedMalformed).toBe(1);
  });

  test("a numeric id is coerced to a string", () => {
    const parsed = parseRecordingsPage({ results: [{ id: 42 }] });
    expect(parsed.recordings[0]?.recordingId).toBe("42");
  });

  test("a recording with no timestamps at all is kept, with nulls rather than a drop", () => {
    const parsed = parseRecordingsPage({ results: [{ id: "ad-3" }] });
    expect(parsed.recordings).toHaveLength(1);
    expect(parsed.recordings[0]?.startedAt).toBeNull();
    expect(parsed.recordings[0]?.lastActivityAt).toBeNull();
    expect(parsed.droppedMalformed).toBe(0);
  });

  test("an unparseable timestamp is null rather than dropping the item", () => {
    const parsed = parseRecordingsPage({
      results: [{ id: "ad-4", start_time: "not-a-date", end_time: "also-not-a-date" }],
    });
    expect(parsed.recordings).toHaveLength(1);
    expect(parsed.recordings[0]?.startedAt).toBeNull();
    expect(parsed.recordings[0]?.lastActivityAt).toBeNull();
    expect(parsed.droppedMalformed).toBe(0);
  });

  test("reads the cursor from next when present", () => {
    const parsed = parseRecordingsPage({
      results: [],
      next: "https://eu.posthog.com/api/projects/1/session_recordings?offset=100",
    });
    expect(parsed.next).toBe("https://eu.posthog.com/api/projects/1/session_recordings?offset=100");
  });

  test("returns next: null when next is absent, null, or empty", () => {
    expect(parseRecordingsPage({ results: [] }).next).toBeNull();
    expect(parseRecordingsPage({ results: [], next: null }).next).toBeNull();
    expect(parseRecordingsPage({ results: [], next: "" }).next).toBeNull();
  });
});

describe("parseSnapshotSources", () => {
  test("parses the verbatim probe fixture: source and a numeric-string blob_key", () => {
    const body = {
      sources: [
        {
          source: "blob_v2",
          start_timestamp: "2026-08-05T06:27:54.726Z",
          end_timestamp: "2026-08-05T06:28:00.000Z",
          blob_key: "0",
        },
        {
          source: "blob_v2",
          start_timestamp: "2026-08-05T06:28:00.000Z",
          end_timestamp: "2026-08-05T06:29:00.000Z",
          blob_key: "1",
        },
      ],
    };

    const parsed = parseSnapshotSources(body);
    expect(parsed.droppedMalformed).toBe(0);
    expect(parsed.sources).toEqual([
      { source: "blob_v2", blobKey: "0" },
      { source: "blob_v2", blobKey: "1" },
    ]);
  });

  test("an empty sources array yields zero items and zero drops", () => {
    const parsed = parseSnapshotSources({ sources: [] });
    expect(parsed.sources).toEqual([]);
    expect(parsed.droppedMalformed).toBe(0);
  });

  test("a body with no sources array counts one malformed page, without throwing", () => {
    expect(() => parseSnapshotSources({ unexpected: true })).not.toThrow();
    expect(parseSnapshotSources({ unexpected: true }).droppedMalformed).toBe(1);
    expect(parseSnapshotSources(null).droppedMalformed).toBe(1);
  });

  test("is tolerant of extra keys and drops and counts an item with no blob_key", () => {
    const parsed = parseSnapshotSources({
      sources: [
        { source: "blob_v2", blob_key: "2", extra_vendor_field: "ignored" },
        { source: "blob_v2", start_timestamp: "2026-08-05T06:27:54.726Z" },
      ],
    });
    expect(parsed.sources).toEqual([{ source: "blob_v2", blobKey: "2" }]);
    expect(parsed.droppedMalformed).toBe(1);
  });

  test("never throws on a non-object item", () => {
    const parsed = parseSnapshotSources({
      sources: [null, "ad-not-an-object", { source: "blob_v2", blob_key: "0" }],
    });
    expect(parsed.sources).toEqual([{ source: "blob_v2", blobKey: "0" }]);
    expect(parsed.droppedMalformed).toBe(2);
  });
});

describe("blobKeyRange", () => {
  test("returns null on an empty list", () => {
    expect(blobKeyRange([])).toBeNull();
  });

  test("a single source's blob key is both the start and the end", () => {
    expect(blobKeyRange([{ source: "blob_v2", blobKey: "5" }])).toEqual({
      start: "5",
      end: "5",
    });
  });

  test("the numeric min and max across multiple sources, not the lexical min and max", () => {
    const sources = [
      { source: "blob_v2", blobKey: "2" },
      { source: "blob_v2", blobKey: "10" },
      { source: "blob_v2", blobKey: "1" },
    ];
    // Lexically "10" < "2", so a string-sort implementation would fail this.
    expect(blobKeyRange(sources)).toEqual({ start: "1", end: "10" });
  });
});

describe("parseSnapshotJsonl", () => {
  test("parses the verbatim probe fixture line: a [windowId, event] tuple", () => {
    const line = JSON.stringify([
      PROBE_WINDOW_ID,
      {
        timestamp: 1785911274726,
        data: { height: 898, href: "https://app.growthmind.ai/settings", width: 1707 },
        type: 4,
      },
    ]);

    const parsed = parseSnapshotJsonl(line);
    expect(parsed.droppedMalformed).toBe(0);
    expect(parsed.decompressionFailures).toBe(0);
    expect(parsed.windowIds).toEqual([PROBE_WINDOW_ID]);
    expect(parsed.events).toEqual([
      {
        type: 4,
        timestamp: 1785911274726,
        data: { height: 898, href: "https://app.growthmind.ai/settings", width: 1707 },
      },
    ]);
  });

  test("gunzips a real gzip payload carried in a cv-marked event and validates the recovered JSON", () => {
    const payload = { type: 2, node: { tagName: "html" }, id: 1 };
    const gzipped = zlib.gzipSync(Buffer.from(JSON.stringify(payload), "utf8"));
    const wireData = gzipped.toString("latin1");

    const line = JSON.stringify([
      PROBE_WINDOW_ID,
      { timestamp: 1785911274726, cv: "2024-10", data: wireData, type: 2 },
    ]);

    const parsed = parseSnapshotJsonl(line);
    expect(parsed.decompressionFailures).toBe(0);
    expect(parsed.droppedMalformed).toBe(0);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]?.data).toEqual(payload);
  });

  test("a corrupt gzip payload is a decompression failure, never a throw, and the event is dropped", () => {
    const gzipped = zlib.gzipSync(Buffer.from(JSON.stringify({ ok: true }), "utf8"));
    const corrupted = Buffer.from(gzipped);
    corrupted[10] = (corrupted[10] ?? 0) ^ 0xff;
    const wireData = corrupted.toString("latin1");

    const line = JSON.stringify([
      PROBE_WINDOW_ID,
      { timestamp: 1785911274726, cv: "2024-10", data: wireData, type: 2 },
    ]);

    expect(() => parseSnapshotJsonl(line)).not.toThrow();
    const parsed = parseSnapshotJsonl(line);
    expect(parsed.decompressionFailures).toBe(1);
    expect(parsed.droppedMalformed).toBe(0);
    expect(parsed.events).toEqual([]);
  });

  test("blank lines between events are skipped, not counted as malformed", () => {
    const validLine = JSON.stringify([PROBE_WINDOW_ID, { timestamp: 1, data: {}, type: 4 }]);
    const parsed = parseSnapshotJsonl(`\n${validLine}\n\n  \n${validLine}\n`);
    expect(parsed.events).toHaveLength(2);
    expect(parsed.droppedMalformed).toBe(0);
  });

  test("garbage lines (unparseable JSON, wrong tuple shape) are dropped, counted, and never thrown", () => {
    const validLine = JSON.stringify([PROBE_WINDOW_ID, { timestamp: 1, data: {}, type: 4 }]);
    const text = [
      "not json at all {{{",
      JSON.stringify({ not: "a tuple" }),
      JSON.stringify([PROBE_WINDOW_ID]),
      JSON.stringify([PROBE_WINDOW_ID, { timestamp: 1, data: {}, type: 4 }, "extra"]),
      JSON.stringify([123, { timestamp: 1, data: {}, type: 4 }]),
      validLine,
    ].join("\n");

    expect(() => parseSnapshotJsonl(text)).not.toThrow();
    const parsed = parseSnapshotJsonl(text);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.droppedMalformed).toBe(5);
    expect(parsed.decompressionFailures).toBe(0);
  });

  test("a malformed event shape is dropped and counted, distinctly from a decompression failure", () => {
    const parsed = parseSnapshotJsonl(
      JSON.stringify([PROBE_WINDOW_ID, { timestamp: -1, data: {}, type: 4 }]),
    );
    expect(parsed.events).toEqual([]);
    expect(parsed.droppedMalformed).toBe(1);
    expect(parsed.decompressionFailures).toBe(0);
  });

  test("distinct window ids are collected in first-seen order", () => {
    const windowA = "ad-window-a";
    const windowB = "ad-window-b";
    const text = [
      JSON.stringify([windowA, { timestamp: 1, data: {}, type: 4 }]),
      JSON.stringify([windowB, { timestamp: 2, data: {}, type: 4 }]),
      JSON.stringify([windowA, { timestamp: 3, data: {}, type: 4 }]),
    ].join("\n");

    const parsed = parseSnapshotJsonl(text);
    expect(parsed.windowIds).toEqual([windowA, windowB]);
  });

  test("wire order is preserved across valid, malformed, and compressed lines", () => {
    const payload = { marker: "third" };
    const gzipped = zlib.gzipSync(Buffer.from(JSON.stringify(payload), "utf8"));
    const text = [
      JSON.stringify([PROBE_WINDOW_ID, { timestamp: 1, data: { marker: "first" }, type: 4 }]),
      "garbage",
      JSON.stringify([PROBE_WINDOW_ID, { timestamp: 2, data: { marker: "second" }, type: 4 }]),
      JSON.stringify([
        PROBE_WINDOW_ID,
        { timestamp: 3, cv: "2024-10", data: gzipped.toString("latin1"), type: 2 },
      ]),
    ].join("\n");

    const parsed = parseSnapshotJsonl(text);
    expect(parsed.events.map((event) => event.data)).toEqual([
      { marker: "first" },
      { marker: "second" },
      payload,
    ]);
    expect(parsed.droppedMalformed).toBe(1);
  });

  test("an empty page yields zero events, zero window ids, and zero counts", () => {
    expect(parseSnapshotJsonl("")).toEqual({
      events: [],
      windowIds: [],
      droppedMalformed: 0,
      decompressionFailures: 0,
    });
  });
});
