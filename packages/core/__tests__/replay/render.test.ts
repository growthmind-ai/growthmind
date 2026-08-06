import { describe, expect, test } from "bun:test";

import { EMPTY_TRANSCRIPT_LINE, renderTranscript, stampOf } from "../../src/replay/render";
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
  doubleClickEvent,
  focusEvent,
  inputEvent,
  metaEvent,
  mouseMoveEvent,
  mutationEvent,
  scrollEvent,
  settingsSnapshot,
} from "./fixtures";

describe("renderTranscript", () => {
  test("should render a person giving up on a form as exact, readable lines", () => {
    const transcript = buildTranscript([
      metaEvent(0, SETTINGS_PAGE),
      settingsSnapshot(10),
      clickEvent(4_000, SUBMIT_NODE_ID),
      focusEvent(6_000, API_KEY_NODE_ID),
      blurEvent(7_000, API_KEY_NODE_ID),
      mouseMoveEvent(8_000),
    ]);

    expect(renderTranscript(transcript)).toBe(
      [
        `0:00  opened ${SETTINGS_PAGE}`,
        "0:04  clicked button.gm-submit#save — nothing happened",
        "0:07  left input[name=apiKey] without typing",
        "0:08  session ended",
      ].join("\n"),
    );
  });

  test("should render a rage click and the wait that followed it", () => {
    const transcript = buildTranscript([
      metaEvent(0, SETTINGS_PAGE),
      settingsSnapshot(10),
      clickEvent(1_000, SUBMIT_NODE_ID),
      clickEvent(1_200, SUBMIT_NODE_ID),
      clickEvent(1_400, SUBMIT_NODE_ID),
      mouseMoveEvent(75_000),
    ]);

    expect(renderTranscript(transcript)).toBe(
      [
        `0:00  opened ${SETTINGS_PAGE}`,
        "0:01  rage-clicked button.gm-submit#save (3 clicks in 400ms)",
        "0:01  waited 74s",
        "1:15  session ended",
      ].join("\n"),
    );
  });

  test("should render every remaining action kind in its own words", () => {
    const transcript = buildTranscript([
      metaEvent(0, SETTINGS_PAGE),
      settingsSnapshot(10),
      doubleClickEvent(1_000, SUBMIT_NODE_ID),
      mutationEvent(1_050),
      focusEvent(2_000, API_KEY_NODE_ID),
      inputEvent(2_100, API_KEY_NODE_ID),
      blurEvent(2_200, API_KEY_NODE_ID),
      focusEvent(3_000, API_KEY_NODE_ID),
      scrollEvent(4_000, SCROLL_NODE_ID, 0, 0),
      scrollEvent(4_100, SCROLL_NODE_ID, 0, 400),
      scrollEvent(4_200, SCROLL_NODE_ID, 0, 0),
      clickEvent(5_000, SUBMIT_NODE_ID),
      mutationEvent(5_050),
      metaEvent(6_000, BILLING_PAGE),
    ]);

    expect(renderTranscript(transcript)).toBe(
      [
        `0:00  opened ${SETTINGS_PAGE}`,
        "0:01  double-clicked button.gm-submit#save",
        "0:02  typed into input[name=apiKey]",
        "0:03  came back to input[name=apiKey] (focus 2)",
        "0:04  scrolled back on div.gm-scroller",
        "0:05  clicked button.gm-submit#save",
        `0:06  opened ${BILLING_PAGE}`,
        "0:06  session ended",
      ].join("\n"),
    );
  });

  test("should say nothing was recorded rather than returning a blank artefact", () => {
    expect(renderTranscript(buildTranscript([]))).toBe(EMPTY_TRANSCRIPT_LINE);
  });

  test("should not hide dropped events from the person reading the transcript", () => {
    const transcript = buildTranscript([
      metaEvent(0, SETTINGS_PAGE),
      { type: 4, timestamp: BASE_TS + 5, data: null },
      { type: 3, timestamp: BASE_TS + 6, data: { source: 5 } },
    ]);

    expect(renderTranscript(transcript)).toBe(
      [`0:00  opened ${SETTINGS_PAGE}`, "0:00  session ended", "(2 malformed events dropped)"].join(
        "\n",
      ),
    );
  });

  test("should describe an element the recording never described rather than dropping the line", () => {
    const transcript = buildTranscript([
      metaEvent(0, SETTINGS_PAGE),
      clickEvent(1_000, 4_242),
      mutationEvent(1_050),
    ]);

    expect(renderTranscript(transcript)).toContain("clicked #unknown(4242)");
  });

  test("should stamp the first line 0:00 rather than the offset the recorder happened to start at", () => {
    const idleMs = 4_673_000;
    const transcript = buildTranscript([
      mouseMoveEvent(0),
      metaEvent(idleMs, SETTINGS_PAGE),
      settingsSnapshot(idleMs + 10),
      clickEvent(idleMs + 4_000, SUBMIT_NODE_ID),
      mutationEvent(idleMs + 4_050),
    ]);

    expect(renderTranscript(transcript).split("\n")).toEqual([
      `0:00  opened ${SETTINGS_PAGE}`,
      "0:04  clicked button.gm-submit#save",
      "0:04  session ended",
    ]);
  });

  test("should keep minutes past the hour readable rather than resetting the clock", () => {
    const transcript = buildTranscript([
      metaEvent(0, SETTINGS_PAGE),
      settingsSnapshot(10),
      mouseMoveEvent(3_725_000),
    ]);

    expect(renderTranscript(transcript)).toContain("62:05  session ended");
  });
});

describe("stampOf", () => {
  test("should render minutes unpadded and seconds zero-padded", () => {
    expect(stampOf(4_000)).toBe("0:04");
    expect(stampOf(65_000)).toBe("1:05");
  });

  test("should keep minutes past the hour readable rather than resetting the clock", () => {
    expect(stampOf(3_725_000)).toBe("62:05");
  });
});
