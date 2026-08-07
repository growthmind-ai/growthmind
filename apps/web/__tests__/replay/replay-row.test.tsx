import { describe, expect, test } from "bun:test";
import { MantineProvider } from "@mantine/core";
import type { ReplayListRow } from "@growthmind/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ReplayRow } from "../../components/replay/ReplayRow";
import { readMarkup, type RenderedCard } from "../first-run/helpers/rendered-markup";

// The verbatim probe session, now as the row the list selects rather than the source recording.
const PROBE: ReplayListRow = {
  recordingId: "019fd09b-61cf-77f8-9b0a-79ea0e302420",
  sessionKey: "ph:019fd09b-61cf-77f8-9b0a-79ea0e302420",
  startedAt: "2026-08-05T06:27:54.726Z",
  companyDomain: "lurio.ai",
  entryUrlPath: "/blog/best-pitch-deck-examples",
  lane: "real",
  exclusionLabel: null,
  durationSeconds: 177,
  activeSeconds: 34,
  clickCount: 15,
  keypressCount: 0,
  consoleErrorCount: 0,
};

const ATTRIBUTE = /\s[a-z-]+="([^"]*)"/g;

function markupOf(row: ReplayListRow): string {
  return renderToStaticMarkup(
    createElement(MantineProvider, null, createElement(ReplayRow, { row })),
  );
}

function render(row: ReplayListRow): RenderedCard {
  return readMarkup(markupOf(row));
}

function attributeValues(markup: string): readonly string[] {
  return [...markup.matchAll(ATTRIBUTE)].map((match) => match[1] ?? "");
}

describe("ReplayRow", () => {
  test("shows active time as the headline number and the wall-clock beside it", () => {
    const card = render(PROBE);

    expect(card.text).toContain("34s active");
    expect(card.text).toContain("2m 57s on the page");
  });

  // Replaces the assertion that a zero counter stayed silent. Under D-7's render rule a measured
  // zero is a reading and says so; only an unstamped null renders nothing, which the meta-badges
  // suite owns. Keeping the old expectation would have re-collapsed the two.
  test("counts clicks, and names the counters measured at zero rather than hiding them", () => {
    const card = render(PROBE);

    expect(card.text).toContain("15 clicks");
    expect(card.text).toContain("0 keystrokes");
    expect(card.text).toContain("0 errors");
  });

  test("names keystrokes and errors when there are any", () => {
    const card = render({ ...PROBE, keypressCount: 1, consoleErrorCount: 3 });

    expect(card.text).toContain("1 keystroke");
    expect(card.text).toContain("3 errors");
  });

  test("the whole row is a single link to the recording, not just the label", () => {
    const markup = markupOf(PROBE);

    expect(markup).toContain(`href="/replays/${PROBE.recordingId}"`);
    // One anchor wrapping the card — a second one nested inside it would be invalid HTML.
    expect(markup.match(/<a[\s>]/g)?.length).toBe(1);
  });

  test("no attribute on the row carries the entry path, because rrweb cannot mask one", () => {
    const token = "68cd04168ebcf5211a79c43a263a90a1b89779a66b807820c1aba461e7640a85";
    const markup = markupOf({ ...PROBE, entryUrlPath: `/share/${token}` });

    expect(markup).not.toContain("title=");
    for (const value of attributeValues(markup)) expect(value).not.toContain(token);
  });

  test("falls back to the recording id when the session recorded no entry path", () => {
    const card = render({ ...PROBE, entryUrlPath: null, activeSeconds: null });

    expect(card.text).toContain(PROBE.recordingId);
    expect(card.text).toContain("2m 57s");
    // No active time, so the wall-clock is the badge and must not also appear as detail.
    expect(card.text).not.toContain("on the page");
  });
});
