import { describe, expect, test } from "bun:test";

import { sessionWalk } from "../../src/spine/walk";
import {
  matchReplayPages,
  matchesSpineWalk,
  normalisedPageAddress,
  pageMatches,
} from "../../src/shipped/page-match";
import { OTHER_PAGE, SHIPPED_PAGE, SHIPPED_PAGE_HREF, shippedSession } from "./fixtures";

describe("a page address becomes the one spelling the spine holds, or nothing", () => {
  test("should give the same path back for every spelling of one page", () => {
    // The write path reports a change against a page a coding agent typed, and the readout
    // joins on exact equality, so these four have to collapse to one string or the change
    // measures nothing and its change key forks.
    for (const written of [
      "/reports",
      "/Reports",
      "/reports/",
      "https://app.example.test/reports?t=1",
    ]) {
      expect({ written, path: normalisedPageAddress(written) }).toEqual({
        written,
        path: "/reports",
      });
    }
  });

  test("should give back nothing when there is no path in it at all", () => {
    expect(normalisedPageAddress("   ")).toBeNull();
    expect(normalisedPageAddress("?utm=x")).toBeNull();
  });

  test("should refuse prose rather than root it into a page address nothing can match", () => {
    // The caller is a coding agent, so an answer in words is the likeliest wrong input. Rooted
    // and accepted, each of these books a change key no visit can ever join, and the mistake
    // only surfaces on the day the readout answers out of nothing.
    for (const written of ["Reports page", "the reports page", "/reports and /settings"]) {
      expect({ written, path: normalisedPageAddress(written) }).toEqual({ written, path: null });
    }
  });

  test("should refuse an address that is not a web one, rather than redact it into a path", () => {
    expect(normalisedPageAddress("mailto:someone@example.test")).toBeNull();
    expect(normalisedPageAddress("javascript:alert(1)")).toBeNull();
    expect(normalisedPageAddress("tel:+15550100")).toBeNull();
  });

  test("should keep accepting the three spellings a page is honestly written in", () => {
    // The refusals above are not allowed to cost the normalise-and-accept behaviour above them.
    expect(normalisedPageAddress("/Reports")).toBe("/reports");
    expect(normalisedPageAddress("/reports/")).toBe("/reports");
    expect(normalisedPageAddress("https://app.example.test/reports?t=1")).toBe("/reports");
    expect(normalisedPageAddress("HTTPS://app.example.test/Reports")).toBe("/reports");
  });

  test("should be its own fixed point, so a second pass cannot re-spell it", () => {
    const once = normalisedPageAddress("/Reports/Archive/");
    expect(once).toBe("/reports/archive");
    expect(normalisedPageAddress(once ?? "")).toBe(once);
  });
});

describe("the replay page strings are not the spine's spelling, so the join normalises", () => {
  test("should normalise a replay page href to the spine's path spelling", () => {
    expect(pageMatches(SHIPPED_PAGE, SHIPPED_PAGE_HREF)).toBe(true);
  });

  test("should strip the origin, the casing and the query in one crossing", () => {
    // The three differences named in Decision 0's evidence table, one string each, so a join
    // that fixes only the casing cannot pass this by accident.
    expect(pageMatches(SHIPPED_PAGE, "https://app.example.test/t053/reports")).toBe(true);
    expect(pageMatches(SHIPPED_PAGE, "/T053/Reports")).toBe(true);
    expect(pageMatches(SHIPPED_PAGE, "/t053/reports?utm=x")).toBe(true);
  });

  test("should refuse a replay page that does not survive isNormalisedUrlPath", () => {
    expect(() => pageMatches(SHIPPED_PAGE, "?utm=x")).not.toThrow();
    expect(pageMatches(SHIPPED_PAGE, "?utm=x")).toBe(false);
  });

  test("should not match a different page that shares a prefix", () => {
    expect(pageMatches(SHIPPED_PAGE, "https://app.example.test/T053/Reports/Archive")).toBe(false);
  });

  test("should not claim a normalisation version for a page derived from a replay", () => {
    // observed-struggle.ts:270-271 refuses to vouch for a version it cannot see, and
    // recording_summaries carries no normalisation-version column to read one from.
    expect(matchReplayPages(SHIPPED_PAGE, [SHIPPED_PAGE_HREF])).toEqual({
      matched: true,
      normalisationVersion: null,
    });
  });

  test("should report no match and no version for a replay that never reached the page", () => {
    expect(matchReplayPages(SHIPPED_PAGE, ["https://app.example.test/T053/Home"])).toEqual({
      matched: false,
      normalisationVersion: null,
    });
  });

  test("should match a spine session by sessionWalk and not by a fresh urlPath read", () => {
    const session = shippedSession({
      id: "walk-repeat",
      paths: [OTHER_PAGE, SHIPPED_PAGE, SHIPPED_PAGE, OTHER_PAGE, SHIPPED_PAGE],
    });

    // The walk collapses the adjacent repeat and keeps the return visit; membership is read off
    // that, never off the raw event list.
    expect(sessionWalk(session)).toEqual([OTHER_PAGE, SHIPPED_PAGE, OTHER_PAGE, SHIPPED_PAGE]);
    expect(matchesSpineWalk(SHIPPED_PAGE, session)).toBe(true);
  });

  test("should not match a spine session whose every path is null", () => {
    const session = shippedSession({ id: "walk-null", paths: [null, null] });

    expect(sessionWalk(session)).toEqual([]);
    expect(matchesSpineWalk(SHIPPED_PAGE, session)).toBe(false);
  });
});
