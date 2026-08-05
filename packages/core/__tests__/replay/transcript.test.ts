import type { RrwebEvent } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { buildTranscript } from "../../src/replay/transcript";
import {
  API_KEY_NODE_ID,
  BASE_TS,
  BILLING_PAGE,
  SCROLL_NODE_ID,
  SETTINGS_PAGE,
  SUBMIT_NODE_ID,
  blurEvent,
  clickEvent,
  focusEvent,
  inputEvent,
  metaEvent,
  mutationEvent,
  scrollEvent,
  settingsSnapshot,
} from "./fixtures";

function busySession(): readonly RrwebEvent[] {
  return [
    metaEvent(0, SETTINGS_PAGE),
    settingsSnapshot(10),
    clickEvent(1_000, SUBMIT_NODE_ID),
    mutationEvent(1_050),
    clickEvent(2_000, SCROLL_NODE_ID),
    clickEvent(5_000, SUBMIT_NODE_ID),
    clickEvent(5_200, SUBMIT_NODE_ID),
    clickEvent(5_400, SUBMIT_NODE_ID),
    focusEvent(6_000, API_KEY_NODE_ID),
    blurEvent(6_100, API_KEY_NODE_ID),
    focusEvent(7_000, API_KEY_NODE_ID),
    inputEvent(7_100, API_KEY_NODE_ID),
    blurEvent(7_200, API_KEY_NODE_ID),
    scrollEvent(8_000, SCROLL_NODE_ID, 0, 0),
    scrollEvent(8_100, SCROLL_NODE_ID, 0, 400),
    scrollEvent(8_200, SCROLL_NODE_ID, 0, 0),
    metaEvent(9_000, BILLING_PAGE),
  ];
}

const MALFORMED: readonly RrwebEvent[] = [
  { type: 4, timestamp: BASE_TS + 20, data: null },
  { type: 3, timestamp: Number.NaN, data: { source: 2, type: 2, id: 1 } },
  { type: 3, timestamp: BASE_TS + 30, data: { source: 5 } },
];

describe("buildTranscript", () => {
  test("should order every derived action by the moment it happened", () => {
    const transcript = buildTranscript(busySession());

    expect(transcript.actions.map((action) => action.kind)).toEqual([
      "page",
      "click",
      "dead_click",
      "rage_click",
      "field_abandoned",
      "field_refocus",
      "input",
      "scroll_back",
      "page",
      "ended",
    ]);
  });

  test("should count clicks, dead clicks, rage clicks, refocuses, abandoned fields and scroll backs", () => {
    expect(buildTranscript(busySession()).counts).toEqual({
      clicks: 1,
      deadClicks: 1,
      rageClicks: 1,
      refocuses: 1,
      abandonedFields: 1,
      scrollBacks: 1,
    });
  });

  test("should report the session's start and duration from its first and last event", () => {
    const transcript = buildTranscript(busySession());

    expect(transcript.startedAt).toEqual(new Date(BASE_TS));
    expect(transcript.durationMs).toBe(9_000);
  });

  test("should list each distinct page once, in the order it was first opened", () => {
    const transcript = buildTranscript([
      ...busySession(),
      metaEvent(9_500, SETTINGS_PAGE),
      metaEvent(9_600, BILLING_PAGE),
    ]);

    expect(transcript.pages).toEqual([SETTINGS_PAGE, BILLING_PAGE]);
  });

  test("should count malformed events in droppedEvents rather than throwing on them", () => {
    const transcript = buildTranscript([...busySession(), ...MALFORMED]);

    expect(transcript.droppedEvents).toBe(MALFORMED.length);
    expect(transcript.counts.rageClicks).toBe(1);
  });

  test("should not let a malformed event change the counts of the events around it", () => {
    const clean = buildTranscript(busySession());
    const noisy = buildTranscript([...busySession(), ...MALFORMED]);

    expect(noisy.actions).toEqual(clean.actions);
  });

  test("should return an empty transcript with no start for an empty event list", () => {
    expect(buildTranscript([])).toEqual({
      actions: [],
      startedAt: null,
      durationMs: 0,
      pages: [],
      counts: {
        clicks: 0,
        deadClicks: 0,
        rageClicks: 0,
        refocuses: 0,
        abandonedFields: 0,
        scrollBacks: 0,
      },
      droppedEvents: 0,
    });
  });

  test("should not claim a start or a duration when every event was dropped", () => {
    const transcript = buildTranscript(MALFORMED);

    expect(transcript.startedAt).toBeNull();
    expect(transcript.durationMs).toBe(0);
    expect(transcript.actions).toEqual([]);
    expect(transcript.droppedEvents).toBe(MALFORMED.length);
  });

  test("should stay short and honest for a session where nothing happened", () => {
    const transcript = buildTranscript([metaEvent(0, SETTINGS_PAGE), settingsSnapshot(10)]);

    expect(transcript.actions.map((action) => action.kind)).toEqual(["page", "ended"]);
    expect(transcript.counts).toEqual({
      clicks: 0,
      deadClicks: 0,
      rageClicks: 0,
      refocuses: 0,
      abandonedFields: 0,
      scrollBacks: 0,
    });
  });

  test("should produce the same transcript twice for the same recording", () => {
    expect(buildTranscript(busySession())).toEqual(buildTranscript(busySession()));
  });

  test("should not mutate the events it was handed", () => {
    const events = busySession();
    const before = JSON.stringify(events);

    buildTranscript(events);

    expect(JSON.stringify(events)).toBe(before);
  });
});
