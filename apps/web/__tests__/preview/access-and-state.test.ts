import { describe, expect, test } from "bun:test";

import { isPreviewViewer, parsePreviewAllowList } from "../../lib/preview/access";
import {
  decodePreviewState,
  dismissFinding,
  EMPTY_PREVIEW_STATE,
  encodePreviewState,
  hasFix,
  isDismissed,
  isReadOut,
  mintFix,
  readOutVerdict,
  restoreFinding,
} from "../../lib/preview/state";

const VIEWER = { userId: "6B6Q7VaarlVBUSbIqW8dKZAwR7Ri7MzR", email: "tom@example.com" };

describe("the preview allow list", () => {
  test("an absent list lets nobody in, rather than everybody", () => {
    expect(isPreviewViewer(VIEWER, parsePreviewAllowList(undefined))).toBe(false);
    expect(isPreviewViewer(VIEWER, parsePreviewAllowList(""))).toBe(false);
  });

  test("matches a user id", () => {
    expect(isPreviewViewer(VIEWER, parsePreviewAllowList(VIEWER.userId))).toBe(true);
  });

  test("matches an email, so the same person passes in every database", () => {
    expect(isPreviewViewer(VIEWER, parsePreviewAllowList("tom@example.com"))).toBe(true);
    expect(isPreviewViewer(VIEWER, parsePreviewAllowList("TOM@EXAMPLE.COM"))).toBe(true);
  });

  test("reads a comma-separated list and tolerates spacing", () => {
    const allowed = parsePreviewAllowList(" abc , tom@example.com ,, def ");

    expect(allowed.has("abc")).toBe(true);
    expect(allowed.has("def")).toBe(true);
    expect(isPreviewViewer(VIEWER, allowed)).toBe(true);
  });

  test("turns away someone not on the list, and a signed-out visitor", () => {
    const allowed = parsePreviewAllowList("someone-else");

    expect(isPreviewViewer(VIEWER, allowed)).toBe(false);
    expect(isPreviewViewer(null, allowed)).toBe(false);
  });

  test("a viewer with no email is matched on id alone, never on an empty string", () => {
    const noEmail = { userId: "abc", email: null };

    expect(isPreviewViewer(noEmail, parsePreviewAllowList("abc"))).toBe(true);
    expect(isPreviewViewer(noEmail, parsePreviewAllowList("nothing"))).toBe(false);
  });
});

describe("the preview state cookie", () => {
  test("survives a round trip", () => {
    const state = readOutVerdict(
      mintFix(dismissFinding(EMPTY_PREVIEW_STATE, "a", "too small"), "b"),
      "b",
    );

    expect(decodePreviewState(encodePreviewState(state))).toEqual(state);
  });

  test("degrades to empty rather than throwing on a hand-edited value", () => {
    for (const raw of [undefined, "", "not json", "%7Bbroken", "null", "[]"]) {
      expect(decodePreviewState(raw)).toEqual(EMPTY_PREVIEW_STATE);
    }
  });

  test("drops entries of the wrong shape instead of trusting them", () => {
    const raw = encodeURIComponent(
      JSON.stringify({ dismissed: { a: 1, b: "ok" }, fixes: [2, "c"] }),
    );
    const state = decodePreviewState(raw);

    expect(state.dismissed).toEqual({ b: "ok" });
    expect(state.fixes).toEqual(["c"]);
    expect(state.readOut).toEqual([]);
  });

  test("a dismissal remembers its reason and can be undone", () => {
    const dismissed = dismissFinding(EMPTY_PREVIEW_STATE, "a", "already knew");

    expect(isDismissed(dismissed, "a")).toBe(true);
    expect(dismissed.dismissed.a).toBe("already knew");
    expect(isDismissed(restoreFinding(dismissed, "a"), "a")).toBe(false);
  });

  test("minting the same fix twice is one fix", () => {
    const once = mintFix(EMPTY_PREVIEW_STATE, "a");

    expect(mintFix(once, "a")).toBe(once);
    expect(hasFix(once, "a")).toBe(true);
    expect(hasFix(once, "b")).toBe(false);
  });

  test("reading out the same verdict twice is one read-out", () => {
    const once = readOutVerdict(EMPTY_PREVIEW_STATE, "a");

    expect(readOutVerdict(once, "a")).toBe(once);
    expect(isReadOut(once, "a")).toBe(true);
  });

  test("every reducer leaves the state it was given alone", () => {
    const before = dismissFinding(EMPTY_PREVIEW_STATE, "a", "too small");
    const snapshot = JSON.stringify(before);

    dismissFinding(before, "b", "won't fix");
    mintFix(before, "c");
    restoreFinding(before, "a");

    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
