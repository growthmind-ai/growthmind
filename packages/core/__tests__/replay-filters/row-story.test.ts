import { describe, expect, it } from "bun:test";

import {
  REPLAY_ROW_PAGE_TAG_CAP,
  replayRowStory,
  type ReplayListRow,
  type ReplayRowSummary,
} from "../../src";

const ROW: ReplayListRow = {
  recordingId: "019fddb8-90cf-771e-81f5-051149554982",
  sessionKey: "ph:019fddb8-90cf-771e-81f5-051149554982",
  startedAt: "2026-08-07T20:34:00.000Z",
  companyDomain: null,
  entryUrlPath: "/pricing",
  lane: "real",
  exclusionLabel: null,
  durationSeconds: null,
  activeSeconds: null,
  clickCount: null,
  keypressCount: null,
  consoleErrorCount: null,
};

function summary(over: Partial<ReplayRowSummary> = {}): ReplayRowSummary {
  return { headline: "They stalled on the plan picker", pages: ["/pricing"], ...over };
}

describe("replayRowStory", () => {
  it("titles the row with the narration when there is one", () => {
    const story = replayRowStory(ROW, summary());

    expect(story.title).toBe("They stalled on the plan picker");
    expect(story.fromHeadline).toBe(true);
  });

  it("falls back to the entry path when the recording was never narrated", () => {
    const story = replayRowStory(ROW, null);

    expect(story.title).toBe("/pricing");
    expect(story.fromHeadline).toBe(false);
  });

  // A headline held for residual PII arrives here as null, and must read exactly like one that
  // was never written: the row may not hint that text exists which it is refusing to show.
  it("falls back to the entry path when the narration is held", () => {
    const story = replayRowStory(ROW, summary({ headline: null }));

    expect(story.title).toBe("/pricing");
    expect(story.fromHeadline).toBe(false);
  });

  it("falls back to the recording id when the session has no entry path either", () => {
    const story = replayRowStory({ ...ROW, entryUrlPath: null }, null);

    expect(story.title).toBe(ROW.recordingId);
    expect(story.pages).toEqual([]);
  });

  it("treats a blank headline as no headline", () => {
    const story = replayRowStory(ROW, summary({ headline: "   " }));

    expect(story.title).toBe("/pricing");
    expect(story.fromHeadline).toBe(false);
  });

  it("lists every page the narration recorded", () => {
    const story = replayRowStory(ROW, summary({ pages: ["/", "/pricing", "/signup"] }));

    expect(story.pages).toEqual(["/", "/pricing", "/signup"]);
    expect(story.morePages).toBe(0);
  });

  // A session that bounces between two pages lists each once. The tag row says where someone
  // went, not how many times they went there.
  it("lists a revisited page once", () => {
    const story = replayRowStory(ROW, summary({ pages: ["/", "/pricing", "/", "/pricing"] }));

    expect(story.pages).toEqual(["/", "/pricing"]);
  });

  it("stands the entry path in when the narration listed no pages", () => {
    const story = replayRowStory(ROW, summary({ pages: [] }));

    expect(story.pages).toEqual(["/pricing"]);
  });

  it("counts the pages it could not fit rather than dropping them silently", () => {
    const pages = ["/a", "/b", "/c", "/d", "/e", "/f"];
    const story = replayRowStory(ROW, summary({ pages }));

    expect(story.pages).toHaveLength(REPLAY_ROW_PAGE_TAG_CAP);
    expect(story.morePages).toBe(pages.length - REPLAY_ROW_PAGE_TAG_CAP);
  });
});
