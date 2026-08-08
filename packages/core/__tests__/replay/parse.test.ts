import type { RrwebEvent } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { RRWEB_EVENT_TYPE, asRecord, readReplayEvents } from "../../src/replay/parse";
import {
  BASE_TS,
  SETTINGS_PAGE,
  SUBMIT_NODE_ID,
  clickEvent,
  metaEvent,
  mouseMoveEvent,
  mutationEvent,
  scrollEvent,
  settingsSnapshot,
} from "./fixtures";

describe("readReplayEvents", () => {
  test("should read a meta event as a page fact carrying its href", () => {
    const read = readReplayEvents([metaEvent(0, SETTINGS_PAGE)]);

    expect(read.dropped).toBe(0);
    expect(read.facts).toEqual([{ kind: "page", tsMs: BASE_TS, href: SETTINGS_PAGE }]);
    expect(read.firstTsMs).toBe(BASE_TS);
    expect(read.lastTsMs).toBe(BASE_TS);
  });

  test("should return no facts and no timestamps for an empty event list", () => {
    const read = readReplayEvents([]);

    expect(read.facts).toEqual([]);
    expect(read.dropped).toBe(0);
    expect(read.firstTsMs).toBeNull();
    expect(read.lastTsMs).toBeNull();
  });

  test("should drop an event whose timestamp is not finite rather than throwing", () => {
    const malformed: RrwebEvent = {
      type: RRWEB_EVENT_TYPE.meta,
      timestamp: Number.NaN,
      data: { href: SETTINGS_PAGE },
    };

    const read = readReplayEvents([malformed, metaEvent(0, SETTINGS_PAGE)]);

    expect(read.dropped).toBe(1);
    expect(read.facts).toHaveLength(1);
  });

  test("should drop a meta event with no href rather than inventing a page", () => {
    const read = readReplayEvents([
      { type: RRWEB_EVENT_TYPE.meta, timestamp: BASE_TS, data: { width: 800 } },
    ]);

    expect(read.dropped).toBe(1);
    expect(read.facts).toEqual([]);
  });

  test("should drop a mouse interaction with no node id rather than guessing one", () => {
    const read = readReplayEvents([
      {
        type: RRWEB_EVENT_TYPE.incrementalSnapshot,
        timestamp: BASE_TS,
        data: { source: 2, type: 2 },
      },
      clickEvent(0, SUBMIT_NODE_ID),
    ]);

    expect(read.dropped).toBe(1);
    expect(read.facts).toEqual([
      { kind: "mouse", tsMs: BASE_TS, interaction: 2, nodeId: SUBMIT_NODE_ID },
    ]);
  });

  test("should drop a scroll with a non-numeric coordinate rather than reading it as zero", () => {
    const read = readReplayEvents([
      {
        type: RRWEB_EVENT_TYPE.incrementalSnapshot,
        timestamp: BASE_TS,
        data: { source: 3, id: 5, x: 0, y: "down" },
      },
    ]);

    expect(read.dropped).toBe(1);
    expect(read.facts).toEqual([]);
  });

  test("should drop an incremental event with no source rather than classifying it", () => {
    const read = readReplayEvents([
      { type: RRWEB_EVENT_TYPE.incrementalSnapshot, timestamp: BASE_TS, data: {} },
      { type: RRWEB_EVENT_TYPE.incrementalSnapshot, timestamp: BASE_TS, data: null },
    ]);

    expect(read.dropped).toBe(2);
    expect(read.facts).toEqual([]);
  });

  test("should not drop an unrecognised incremental source, keeping it as timing only", () => {
    const read = readReplayEvents([mouseMoveEvent(500)]);

    expect(read.dropped).toBe(0);
    expect(read.facts).toEqual([{ kind: "other", tsMs: BASE_TS + 500 }]);
  });

  test("should not drop a load or custom event, keeping it as timing only", () => {
    const read = readReplayEvents([
      { type: 1, timestamp: BASE_TS, data: {} },
      { type: 5, timestamp: BASE_TS + 10, data: { tag: "anything", payload: {} } },
    ]);

    expect(read.dropped).toBe(0);
    expect(read.facts.map((fact) => fact.kind)).toEqual(["other", "other"]);
  });

  test("should read a mutation's added nodes and ignore entries with no node", () => {
    const read = readReplayEvents([mutationEvent(5)]);

    expect(read.facts).toEqual([
      { kind: "mutation", tsMs: BASE_TS + 5, adds: [], removedParentIds: [] },
    ]);
  });

  test("should order facts by timestamp regardless of the order they arrived in", () => {
    const read = readReplayEvents([
      scrollEvent(900, 5, 0, 100),
      metaEvent(0, SETTINGS_PAGE),
      settingsSnapshot(10),
    ]);

    expect(read.facts.map((fact) => fact.kind)).toEqual(["page", "snapshot", "scroll"]);
    expect(read.firstTsMs).toBe(BASE_TS);
    expect(read.lastTsMs).toBe(BASE_TS + 900);
  });

  test("should keep wire order for two events sharing a millisecond", () => {
    const read = readReplayEvents([clickEvent(50, 7), clickEvent(50, 8)]);

    expect(read.facts).toEqual([
      { kind: "mouse", tsMs: BASE_TS + 50, interaction: 2, nodeId: 7 },
      { kind: "mouse", tsMs: BASE_TS + 50, interaction: 2, nodeId: 8 },
    ]);
  });
});

describe("asRecord", () => {
  test("should read a plain object as a record", () => {
    expect(asRecord({ href: SETTINGS_PAGE })).toEqual({ href: SETTINGS_PAGE });
  });

  test("should not treat null, an array or a primitive as a record", () => {
    expect(asRecord(null)).toBeNull();
    expect(asRecord([1, 2])).toBeNull();
    expect(asRecord("node")).toBeNull();
    expect(asRecord(undefined)).toBeNull();
  });
});
