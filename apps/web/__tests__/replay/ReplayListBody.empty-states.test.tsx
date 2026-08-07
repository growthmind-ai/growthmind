import { afterEach, describe, expect, test } from "bun:test";
import { MantineProvider } from "@mantine/core";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";

import type { ReplayListRow } from "@growthmind/core";
import { REPLAY_DEFAULT_LANE } from "@growthmind/shared";
import type { ReplayFilters } from "@growthmind/shared";

import { ReplayListBody } from "../../components/replay/ReplayListBody";
import type { ReplayScreen } from "../../lib/replay/read";
import { readMarkup, type RenderedCard } from "../first-run/helpers/rendered-markup";

type ScreenArm = Extract<ReplayScreen, { readonly kind: "screen" }>;

function filters(overrides: Partial<ReplayFilters> = {}): ReplayFilters {
  return { company: null, entry: null, lane: REPLAY_DEFAULT_LANE, ...overrides };
}

const NO_FACETS: ScreenArm["facets"] = {
  company: [],
  entry: [],
  whoCounts: [
    { value: "real", sessionCount: 0, replayCount: 0 },
    { value: "simulated", sessionCount: 0, replayCount: 0 },
    { value: "excluded", sessionCount: 0, replayCount: 0 },
  ],
};

function row(sessionKey: string, entryUrlPath: string): ReplayListRow {
  return {
    recordingId: sessionKey.slice(3),
    sessionKey,
    startedAt: "2026-08-05T06:27:54.726Z",
    companyDomain: "acme.com",
    entryUrlPath,
    lane: "real",
    exclusionLabel: null,
    durationSeconds: null,
    activeSeconds: null,
    clickCount: null,
    keypressCount: null,
    consoleErrorCount: null,
  };
}

const THREE_ROWS: readonly ReplayListRow[] = [
  row("ph:one", "/pricing"),
  row("ph:two", "/pricing"),
  row("ph:three", "/docs"),
];

function screen(overrides: Partial<ScreenArm> = {}): ReplayScreen {
  return {
    kind: "screen",
    rows: [],
    provenance: { replays: 0, sessions: 0 },
    tailNote: null,
    facets: NO_FACETS,
    truncated: false,
    outcome: "rows",
    ...overrides,
  };
}

function paint(state: ReplayScreen, applied: ReplayFilters): RenderedCard {
  const { container } = render(
    createElement(
      MantineProvider,
      null,
      createElement(ReplayListBody, { screen: state, filters: applied }),
    ),
  );

  return readMarkup(container.innerHTML);
}

interface Terminal {
  readonly id: string;
  readonly screen: ReplayScreen;
  readonly filters: ReplayFilters;
  readonly heading: string;
  readonly body: string;
  readonly action: string;
  // Absent for the two states that come off no completed read: there is no denominator to
  // state, and rendering "0 replays from 0 sessions" there would report a count we never took.
  readonly provenance: string | null;
}

// .ai/ux/o-050-replays-filters.md §6.2, verbatim. E3 is deliberately absent — it is computed,
// and it belongs to over-filtered.test.ts.
const TERMINALS: readonly Terminal[] = [
  {
    id: "E1 no replays at all",
    screen: screen({ outcome: "no_replays_yet" }),
    filters: filters(),
    heading: "No replays yet",
    body: "They appear here once people have used your product and their sessions have finished. If you expected some by now, the exclusion rules in Settings are the first place to look.",
    action: "Check your exclusion rules",
    provenance: "0 replays from 0 sessions.",
  },
  {
    id: "E2 not connected",
    screen: { kind: "not_connected" },
    filters: filters(),
    heading: "Connect your analytics to watch replays",
    body: "Replays come from the same place your events do, so there is nothing to show until it is connected.",
    action: "Connect your analytics",
    provenance: null,
  },
  {
    id: "E4 over-filtered, no single filter is the reason",
    screen: screen({ outcome: "clear_all" }),
    filters: filters({ company: "acme.com", entry: "/pricing" }),
    heading: "No sessions match all your filters",
    body: "No single one of them is the reason on its own — it is the combination.",
    action: "Clear all filters",
    provenance: "0 replays from 0 acme.com sessions that started at /pricing.",
  },
  {
    id: "E5 a filter value that matches nothing",
    screen: screen({ outcome: "value_matches_nothing" }),
    filters: filters({ company: "orbitlabs.co.uk" }),
    heading: "No sessions match all your filters",
    body: "We have no sessions from orbitlabs.co.uk. It may have aged out of what we hold, or the address may be out of date.",
    action: "Clear the company filter",
    provenance: "0 replays from 0 orbitlabs.co.uk sessions.",
  },
  {
    id: "E6 simulated lane, permanent zero",
    screen: screen({
      outcome: "simulated_permanent_zero",
      provenance: { replays: 0, sessions: 2 },
    }),
    filters: filters({ lane: "simulated" }),
    heading: "Simulated sessions aren't recorded",
    body: "We ran 2 simulated sessions through your product, but nothing rendered a browser, so there is nothing to play. What they found is in your findings.",
    action: "Show real people",
    provenance: "0 replays from 2 simulated sessions.",
  },
  {
    id: "E7 company has sessions and none were recorded",
    screen: screen({
      outcome: "zero_replays_for_selection",
      provenance: { replays: 0, sessions: 5 },
    }),
    filters: filters({ company: "acme.com" }),
    heading: "Nothing to watch from acme.com yet",
    body: "We have seen 5 sessions from acme.com, but none of them were recorded.",
    action: "Show all companies",
    provenance: "0 replays from 5 acme.com sessions.",
  },
  {
    id: "E9 excluded lane is empty",
    screen: screen({ outcome: "nothing_left_out" }),
    filters: filters({ lane: "excluded" }),
    heading: "Nothing was left out",
    body: "Every session we have seen counted as a real person. When we set one aside — your own team, a crawler, a coding agent — it appears here with the reason.",
    action: "Show real people",
    provenance: "0 replays from 0 sessions we left out of your findings.",
  },
  {
    id: "E10 the list could not be read",
    screen: { kind: "failed", filters: filters({ company: "acme.com", entry: "/pricing" }) },
    filters: filters({ company: "acme.com", entry: "/pricing" }),
    heading: "We could not load your replays just now",
    body: "Nothing is lost — it is still in your analytics.",
    action: "Try again",
    provenance: null,
  },
];

const TAIL_NOTE = "4 matching sessions weren't recorded, so they aren't listed above.";
const TRUNCATION_NOTICE =
  "These are your most recent sessions — we read one page at a time so this screen stays quick. The counts above are for what we read, so there may be more.";

afterEach(cleanup);

describe("ReplayListBody terminal states", () => {
  // E7 with the company filter on. The number is the whole point: "nothing here" and "we have
  // seen five and recorded none of them" are different answers, and only the second one is true.
  test("the zero-replays state names the session count it has and offers exactly one action", () => {
    const card = paint(
      screen({ outcome: "zero_replays_for_selection", provenance: { replays: 0, sessions: 5 } }),
      filters({ company: "acme.com" }),
    );

    expect(card.text).toContain("Nothing to watch from acme.com yet");
    expect(card.text).toContain(
      "We have seen 5 sessions from acme.com, but none of them were recorded.",
    );

    expect(card.controls).toHaveLength(1);
    expect(card.controls[0] ?? "").toContain("Show all companies");

    // R-3: this state clears the company filter only. Clearing everything throws away work the
    // founder did on purpose, and the frozen frame is right where the running demo is wrong.
    expect(card.text).not.toContain("Clear all filters");
    expect(card.text).not.toContain("Show everything");
  });

  test("every terminal state renders exactly one action", () => {
    const rendered = TERMINALS.map((terminal) => {
      cleanup();
      const card = paint(terminal.screen, terminal.filters);

      return {
        id: terminal.id,
        heading: card.text.includes(terminal.heading),
        body: card.text.includes(terminal.body),
        actions: card.controls.length,
        named: (card.controls[0] ?? "").includes(terminal.action),
      };
    });

    expect(rendered).toEqual(
      TERMINALS.map((terminal) => ({
        id: terminal.id,
        heading: true,
        body: true,
        actions: 1,
        named: true,
      })),
    );
  });

  // FR-18 / T6. A terminal state that drops the denominator answers "nothing" where the
  // sentence above it answered "nothing out of five", and only the second is actionable.
  test("the provenance sentence renders above every terminal state carrying both numbers", () => {
    const counted = TERMINALS.filter((terminal) => terminal.provenance !== null);

    const rendered = counted.map((terminal) => {
      cleanup();
      const card = paint(terminal.screen, terminal.filters);
      const sentenceAt = card.text.indexOf(terminal.provenance ?? "");
      const headingAt = card.text.indexOf(terminal.heading);

      return {
        id: terminal.id,
        present: sentenceAt >= 0,
        above: sentenceAt >= 0 && headingAt >= 0 && sentenceAt < headingAt,
      };
    });

    expect(rendered).toEqual(
      counted.map((terminal) => ({ id: terminal.id, present: true, above: true })),
    );
  });

  // UX §4.3. The branch rule is tailNote()'s, tested in packages/core; what is asserted here is
  // that the body renders the sentence it was handed and renders nothing when handed none.
  test("the tail note renders when the denominator exceeds the numerator and is absent when they match", () => {
    const gap = paint(
      screen({ rows: THREE_ROWS, provenance: { replays: 3, sessions: 7 }, tailNote: TAIL_NOTE }),
      filters(),
    );

    expect(gap.text).toContain(TAIL_NOTE);

    cleanup();

    const matched = paint(
      screen({ rows: THREE_ROWS, provenance: { replays: 3, sessions: 3 }, tailNote: null }),
      filters(),
    );

    expect(matched.text).not.toContain("weren't recorded");
    expect(matched.text).not.toContain("wasn't recorded");
  });

  // E12 and §4.3 are different sentences about different facts: one says some matching sessions
  // have no replay, the other says the count itself is a floor. Collapsing them loses a fact.
  test("the truncation notice renders alongside the tail note when both apply", () => {
    const both = paint(
      screen({
        rows: THREE_ROWS,
        provenance: { replays: 3, sessions: 7 },
        tailNote: TAIL_NOTE,
        truncated: true,
      }),
      filters(),
    );

    expect(both.text).toContain(TAIL_NOTE);
    expect(both.text).toContain(TRUNCATION_NOTICE);

    cleanup();

    const untruncated = paint(
      screen({
        rows: THREE_ROWS,
        provenance: { replays: 3, sessions: 7 },
        tailNote: TAIL_NOTE,
        truncated: false,
      }),
      filters(),
    );

    expect(untruncated.text).toContain(TAIL_NOTE);
    expect(untruncated.text).not.toContain("there may be more");
  });
});
