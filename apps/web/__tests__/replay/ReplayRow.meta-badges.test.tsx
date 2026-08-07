import { describe, expect, test } from "bun:test";
import { MantineProvider } from "@mantine/core";
import type { ReplayListRow } from "@growthmind/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ReplayRow } from "../../components/replay/ReplayRow";
import { readMarkup } from "../first-run/helpers/rendered-markup";

// The row a session carries before the poll task has ever stamped it: five nulls, and every
// other field populated so a badge that appears can only have come from the meta.
const UNSTAMPED: ReplayListRow = {
  recordingId: "019fd09b-61cf-77f8-9b0a-79ea0e302420",
  sessionKey: "ph:019fd09b-61cf-77f8-9b0a-79ea0e302420",
  startedAt: "2026-08-05T06:27:54.726Z",
  companyDomain: "acme.com",
  entryUrlPath: "/pricing",
  lane: "real",
  exclusionLabel: null,
  durationSeconds: null,
  activeSeconds: null,
  clickCount: null,
  keypressCount: null,
  consoleErrorCount: null,
};

const BADGE_LABEL = /<span[^>]*class="[^"]*mantine-Badge-label[^"]*"[^>]*>([\s\S]*?)<\/span>/g;

// A time badge in this row's vocabulary: "2m 57s", "0s", "34s active", "0s active".
const TIME_BADGE = /^\d+(m \d+)?s( active)?$/;

// A stand-in for a measurement is the same collapse as a zero: it says something happened.
const PLACEHOLDERS = ["—", "–", "n/a", "N/A", "unknown", "Unknown", "not measured"];

function markupOf(row: ReplayListRow): string {
  return renderToStaticMarkup(
    createElement(MantineProvider, null, createElement(ReplayRow, { row })),
  );
}

function badgesOf(row: ReplayListRow): readonly string[] {
  const found: string[] = [];

  for (const match of markupOf(row).matchAll(BADGE_LABEL)) {
    found.push(
      (match[1] ?? "")
        .replace(/<[^>]*>/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    );
  }

  return found;
}

function textOf(row: ReplayListRow): string {
  return readMarkup(markupOf(row)).text;
}

describe("ReplayRow meta badges — null is unmeasured, zero is a measurement", () => {
  test("should render no badge for a session whose meta was never stamped", () => {
    expect(badgesOf(UNSTAMPED)).toEqual([]);

    // Not a zero, not a dash, not a placeholder: an absent badge is the whole signal.
    const text = textOf(UNSTAMPED);
    expect(text).not.toContain("click");
    expect(text).not.toContain("keystroke");
    expect(text).not.toContain("error");
    expect(text).not.toContain("active");
    for (const placeholder of PLACEHOLDERS) expect(text).not.toContain(placeholder);
  });

  test("should render the badge for a session measured at zero", () => {
    const badges = badgesOf({ ...UNSTAMPED, clickCount: 0, consoleErrorCount: 0 });

    expect(badges).toContain("0 clicks");
    expect(badges).toContain("0 errors");
  });

  // The abandoned tab: forty minutes of wall clock with nothing happening in it. This is the
  // measurement the fifth column was ratified for, and it must not read as a long session.
  test("should render the active-time badge for a session measured at zero active seconds", () => {
    const badges = badgesOf({ ...UNSTAMPED, durationSeconds: 2400, activeSeconds: 0 });

    expect(badges).toContain("0s active");
  });

  test("should render no active-time badge when active seconds is null", () => {
    const badges = badgesOf({ ...UNSTAMPED, durationSeconds: 177, activeSeconds: null });

    expect(badges.filter((badge) => badge.includes("active"))).toEqual([]);
    expect(badges).toContain("2m 57s");
  });

  test("should render each badge independently of the other four", () => {
    const badges = badgesOf({ ...UNSTAMPED, clickCount: 14 });

    expect(badges).toEqual(["14 clicks"]);
  });

  test("should render no duration badge rather than a formatted zero when the duration is null", () => {
    expect(badgesOf(UNSTAMPED).filter((badge) => TIME_BADGE.test(badge))).toEqual([]);

    const measuredZero = badgesOf({ ...UNSTAMPED, durationSeconds: 0, activeSeconds: null });
    expect(measuredZero).toContain("0s");
  });

  // 177 is seconds. A `_ms`-named field would have rendered this as under a fifth of a second.
  test("should format a stamped duration as seconds, not milliseconds", () => {
    const badges = badgesOf({ ...UNSTAMPED, durationSeconds: 177, activeSeconds: null });

    expect(badges).toContain("2m 57s");
    expect(badges).not.toContain("0s");
    expect(badges.join(" ")).not.toContain("177");
  });
});
