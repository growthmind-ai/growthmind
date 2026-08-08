import { describe, expect, test } from "bun:test";

import { recordingLabel, timeOnPage } from "../../lib/replay/label";

const RECORDING_ID = "019fd09b-61cf-77f8-9b0a-79ea0e302420";

describe("recordingLabel", () => {
  test("falls back to the recording id when no start url was recorded", () => {
    expect(recordingLabel(null, RECORDING_ID)).toEqual({
      text: RECORDING_ID,
      source: null,
    });
    expect(recordingLabel("", RECORDING_ID).text).toBe(RECORDING_ID);
    expect(recordingLabel(42, RECORDING_ID).text).toBe(RECORDING_ID);
  });

  test("drops the scheme, www, and the query string that made rows unreadable", () => {
    const messy = "https://lurio.ai/?fbclid=IwcGRvZgRleHRuA2FlbQIxMQABzcnRjBmFwcF9pZAExMDE1NDgzODY";

    expect(recordingLabel(messy, RECORDING_ID).text).toBe("lurio.ai");
    expect(recordingLabel("https://www.lurio.ai/careers", RECORDING_ID).text).toBe(
      "lurio.ai/careers",
    );
  });

  test("keeps the path, which is the part that says which page this was", () => {
    expect(recordingLabel("https://lurio.ai/decks/69f4c94f?slide=12", RECORDING_ID).text).toBe(
      "lurio.ai/decks/69f4c94f",
    );
  });

  test("drops a trailing slash but never leaves a bare host with one", () => {
    expect(recordingLabel("https://lurio.ai/", RECORDING_ID).text).toBe("lurio.ai");
    expect(recordingLabel("https://lurio.ai/careers/", RECORDING_ID).text).toBe("lurio.ai/careers");
  });

  test("surfaces utm_source separately instead of inlining it into the label", () => {
    const labelled = recordingLabel(
      "https://lurio.ai/blog/best-pitch-deck-examples?utm_source=chatgpt.com",
      RECORDING_ID,
    );

    expect(labelled.text).toBe("lurio.ai/blog/best-pitch-deck-examples");
    expect(labelled.source).toBe("chatgpt.com");
  });

  test("treats an empty utm_source as absent", () => {
    expect(recordingLabel("https://lurio.ai/?utm_source=", RECORDING_ID).source).toBeNull();
  });

  test("truncates a long path rather than letting it push the row apart", () => {
    const long =
      "https://lurio.ai/share/68cd04168ebcf5211a79c43a263a90a1b89779a66b807820c1aba461e7640a85";

    const labelled = recordingLabel(long, RECORDING_ID);

    expect(labelled.text.length).toBeLessThanOrEqual(72);
    expect(labelled.text.endsWith("…")).toBe(true);
  });

  // The dropped remainder has nowhere to go: rrweb serialises attributes verbatim, so a
  // title tooltip would ship an end user's share token to a third party. See B-049 and
  // apps/web/__tests__/replay-attribute-exposure.test.ts.
  test("returns no field carrying the untruncated url", () => {
    const long =
      "https://lurio.ai/share/68cd04168ebcf5211a79c43a263a90a1b89779a66b807820c1aba461e7640a85";
    const droppedTail = long.slice(-12);

    // Spread so a field added to RecordingLabel later is checked too, not just the two
    // this test was written against.
    const labelled: Record<string, unknown> = { ...recordingLabel(long, RECORDING_ID) };

    for (const value of Object.values(labelled)) {
      expect(value).not.toBe(long);
      expect(typeof value === "string" && value.includes(droppedTail)).toBe(false);
    }
  });

  test("returns an unparseable url as written rather than dropping the row", () => {
    expect(recordingLabel("not a url", RECORDING_ID)).toEqual({
      text: "not a url",
      source: null,
    });
  });
});

describe("timeOnPage", () => {
  test("leads with active time and returns the wall-clock total to render beside it", () => {
    expect(timeOnPage({ durationSeconds: 177, activeSeconds: 34 })).toEqual({
      badge: "34s active",
      total: "2m 57s",
    });
  });

  test("falls back to wall-clock when the row carries no active time", () => {
    expect(timeOnPage({ durationSeconds: 177, activeSeconds: null })).toEqual({
      badge: "2m 57s",
      total: null,
    });
  });

  test("never returns the same number twice", () => {
    const both = timeOnPage({ durationSeconds: 177, activeSeconds: 34 });
    expect(both?.badge).not.toContain(both?.total ?? "");

    const totalOnly = timeOnPage({ durationSeconds: 177, activeSeconds: null });
    expect(totalOnly?.total).toBeNull();
  });

  test("drops the total when the session was active throughout", () => {
    expect(timeOnPage({ durationSeconds: 7, activeSeconds: 7 })).toEqual({
      badge: "7s active",
      total: null,
    });
  });

  test("drops the total when rounding makes the two read identically", () => {
    // 177s and 176.6s both render "2m 57s"; printing it twice is noise either way.
    expect(timeOnPage({ durationSeconds: 177, activeSeconds: 176.6 })?.total).toBeNull();
  });

  test("reports active time even when the total is missing", () => {
    expect(timeOnPage({ durationSeconds: null, activeSeconds: 34 })).toEqual({
      badge: "34s active",
      total: null,
    });
  });

  // Replaces the assertion that `{ recording_duration: 0, active_seconds: 0 }` reads null.
  // The `value <= 0` guard swallowed a measured zero and rendered it identically to an
  // unmeasured one, which is the collapse ADD D-7's render rule exists to forbid.
  test("should render a badge for a duration or an active time measured at zero", () => {
    expect(timeOnPage({ durationSeconds: null, activeSeconds: null })).toBeNull();

    expect(timeOnPage({ durationSeconds: 0, activeSeconds: 0 })).toEqual({
      badge: "0s active",
      total: null,
    });

    expect(timeOnPage({ durationSeconds: 0, activeSeconds: null })).toEqual({
      badge: "0s",
      total: null,
    });

    // The abandoned tab the fifth column was ratified for: forty minutes of wall clock with
    // nothing happening reads as the zero it was, not as a forty-minute session.
    expect(timeOnPage({ durationSeconds: 2400, activeSeconds: 0 })).toEqual({
      badge: "0s active",
      total: "40m 0s",
    });
  });

  test("should keep both arms of timeOnPage against the two columns", () => {
    expect(timeOnPage({ durationSeconds: 177, activeSeconds: 34 })).toEqual({
      badge: "34s active",
      total: "2m 57s",
    });
    expect(timeOnPage({ durationSeconds: 177, activeSeconds: 177 })?.total).toBeNull();
  });

  test("ignores a non-finite duration rather than rendering NaN", () => {
    expect(timeOnPage({ durationSeconds: Number.NaN, activeSeconds: null })).toBeNull();
  });
});
