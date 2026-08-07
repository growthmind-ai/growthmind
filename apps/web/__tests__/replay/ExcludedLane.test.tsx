import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, test } from "bun:test";
import { MantineProvider } from "@mantine/core";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";

import type { ReplayListRow } from "@growthmind/core";
import { EXCLUSION_REASON_LABELS, REPLAY_DEFAULT_LANE } from "@growthmind/shared";
import type { ReplayFilters, StampedExclusionReason } from "@growthmind/shared";

import { ReplayListBody } from "../../components/replay/ReplayListBody";
import type { ReplayScreen } from "../../lib/replay/read";
import { readMarkup } from "../first-run/helpers/rendered-markup";

type ScreenArm = Extract<ReplayScreen, { readonly kind: "screen" }>;

const WEB_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPLAY_SURFACE = [
  path.join(WEB_ROOT, "components", "replay"),
  path.join(WEB_ROOT, "lib", "replay"),
];

// The four reasons the write path actually stamps. `none` never reaches this lane and
// `outside_who_counts` is never stamped on the column at all (R-6), so neither is here.
const STAMPED: readonly StampedExclusionReason[] = [
  "internal_domain",
  "automation_headless",
  "automation_known_agent",
  "automation_coding_agent",
];

const TITLE = /\stitle="([^"]*)"/g;
const DATA_ATTRIBUTE = /\sdata-[a-z0-9-]+="([^"]*)"/g;

function filters(overrides: Partial<ReplayFilters> = {}): ReplayFilters {
  return { company: null, entry: null, lane: REPLAY_DEFAULT_LANE, ...overrides };
}

function excludedRow(reason: StampedExclusionReason, index: number): ReplayListRow {
  return {
    recordingId: `019fd09b-61cf-77f8-9b0a-79ea0e30242${String(index)}`,
    sessionKey: `ph:excluded-${String(index)}`,
    startedAt: "2026-08-05T06:27:54.726Z",
    companyDomain: "acme.com",
    entryUrlPath: "/pricing",
    lane: "excluded",
    exclusionLabel: EXCLUSION_REASON_LABELS[reason],
    durationSeconds: null,
    activeSeconds: null,
    clickCount: null,
    keypressCount: null,
    consoleErrorCount: null,
  };
}

const EXCLUDED_LANE: ReplayScreen = {
  kind: "screen",
  rows: STAMPED.map(excludedRow),
  provenance: { replays: 4, sessions: 4 },
  tailNote: null,
  facets: {
    company: [{ value: "acme.com", sessionCount: 4, replayCount: 4 }],
    entry: [{ value: "/pricing", sessionCount: 4, replayCount: 4 }],
    whoCounts: [
      { value: "real", sessionCount: 0, replayCount: 0 },
      { value: "simulated", sessionCount: 0, replayCount: 0 },
      { value: "excluded", sessionCount: 4, replayCount: 4 },
    ],
  } satisfies ScreenArm["facets"],
  truncated: false,
  outcome: "rows",
};

function laneMarkup(): string {
  const { container } = render(
    createElement(
      MantineProvider,
      null,
      createElement(ReplayListBody, {
        screen: EXCLUDED_LANE,
        filters: filters({ lane: "excluded" }),
      }),
    ),
  );

  return container.innerHTML;
}

function attributeValues(markup: string): readonly string[] {
  const found: string[] = [];

  for (const pattern of [TITLE, DATA_ATTRIBUTE]) {
    for (const match of markup.matchAll(pattern)) found.push(match[1] ?? "");
  }

  return found;
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(full, acc);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      acc.push(full);
    }
  }
  return acc;
}

afterEach(cleanup);

describe("the excluded lane", () => {
  // UX First-Run row 6 / AC-11. P-2's trust surface: "we leave your own traffic out" is a
  // promise until the reason for each one is readable by someone who has never seen the schema.
  test("a non-technical operator reads every exclusion reason as a plain-English sentence", () => {
    const text = readMarkup(laneMarkup()).text;

    const rendered = STAMPED.map((reason) => ({
      reason,
      shown: text.includes(EXCLUSION_REASON_LABELS[reason]),
    }));

    expect(rendered).toEqual(STAMPED.map((reason) => ({ reason, shown: true })));
  });

  // Not just the visible text: a raw enum in a `title` or a `data-*` is one screenshot away
  // from a customer, and both survive a copy-paste that the DOM text does not.
  test("no raw exclusion enum reaches the rendered output", () => {
    const markup = laneMarkup();
    const text = readMarkup(markup).text;
    const attributes = attributeValues(markup);

    const leaked = STAMPED.filter(
      (reason) => text.includes(reason) || attributes.some((value) => value.includes(reason)),
    );

    expect(leaked).toEqual([]);
  });

  // UX §5. The shipped constant's casing wins over the prototype's lowercase fragments, and
  // the only way to keep one copy is for no source on this surface to spell the strings at all.
  test("the excluded lane authors no second copy of the exclusion labels", () => {
    const text = readMarkup(laneMarkup()).text;

    const miscased = STAMPED.filter((reason) =>
      text.includes(EXCLUSION_REASON_LABELS[reason].toLowerCase()),
    );

    expect(miscased).toEqual([]);

    const offenders: string[] = [];

    for (const directory of REPLAY_SURFACE) {
      for (const file of sourceFiles(directory)) {
        const source = readFileSync(file, "utf8");
        if (STAMPED.some((reason) => source.includes(EXCLUSION_REASON_LABELS[reason]))) {
          offenders.push(path.relative(WEB_ROOT, file).replaceAll("\\", "/"));
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
