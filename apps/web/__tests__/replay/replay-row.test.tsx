import { describe, expect, test } from "bun:test";
import { MantineProvider } from "@mantine/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ReplayRow, type ListedRecording } from "../../components/replay/ReplayRow";
import { readMarkup, type RenderedCard } from "../first-run/helpers/rendered-markup";

// The verbatim probe recording, plus the share-token url that made a row three lines tall.
const PROBE: ListedRecording = {
  recordingId: "019fd09b-61cf-77f8-9b0a-79ea0e302420",
  startedAt: "2026-08-05T06:27:54.726Z",
  meta: {
    recording_duration: 177,
    active_seconds: 34,
    click_count: 15,
    keypress_count: 0,
    mouse_activity_count: 125,
    console_error_count: 0,
    start_url: "https://lurio.ai/blog/best-pitch-deck-examples?utm_source=chatgpt.com",
  },
};

function render(recording: ListedRecording): RenderedCard {
  return readMarkup(
    renderToStaticMarkup(
      createElement(MantineProvider, null, createElement(ReplayRow, { recording })),
    ),
  );
}

describe("ReplayRow", () => {
  test("leads with the page, not the tracking parameters that came with it", () => {
    const card = render(PROBE);

    expect(card.text).toContain("lurio.ai/blog/best-pitch-deck-examples");
    expect(card.text).not.toContain("utm_source=");
    expect(card.text).toContain("from chatgpt.com");
  });

  test("shows active time as the headline number and the wall-clock beside it", () => {
    const card = render(PROBE);

    expect(card.text).toContain("34s active");
    expect(card.text).toContain("2m 57s on the page");
  });

  test("counts clicks, and stays silent about the counters that are zero", () => {
    const card = render(PROBE);

    expect(card.text).toContain("15 clicks");
    expect(card.text).not.toContain("keystroke");
    expect(card.text).not.toContain("error");
  });

  test("names keystrokes and errors when there are any", () => {
    const card = render({
      ...PROBE,
      meta: { ...PROBE.meta, keypress_count: 1, console_error_count: 3 },
    });

    expect(card.text).toContain("1 keystroke");
    expect(card.text).toContain("3 errors");
  });

  test("no attribute on the row carries the url, because rrweb cannot mask one", () => {
    const messy = {
      ...PROBE,
      meta: {
        ...PROBE.meta,
        start_url:
          "https://lurio.ai/share/68cd04168ebcf5211a79c43a263a90a1b89779a66b807820c1aba461e7640a85",
      },
    };

    const markup = renderToStaticMarkup(
      createElement(MantineProvider, null, createElement(ReplayRow, { recording: messy })),
    );

    expect(markup).not.toContain("title=");
    expect(markup).not.toContain("e7640a85");
  });

  test("links to the recording and falls back to its id when no url was recorded", () => {
    const card = render({ ...PROBE, meta: { recording_duration: 177 } });

    expect(card.text).toContain(PROBE.recordingId);
    expect(card.text).toContain("2m 57s");
    // No active_seconds, so the wall-clock is the badge and must not also appear as detail.
    expect(card.text).not.toContain("on the page");
  });

  test("says so rather than rendering nothing when the source recorded no start time", () => {
    const card = render({ ...PROBE, startedAt: null });

    expect(card.text).toContain("Time not recorded");
  });
});
