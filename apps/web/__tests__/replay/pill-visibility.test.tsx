import { describe, expect, test } from "bun:test";
import { MantineProvider } from "@mantine/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { theme } from "@/lib/theme";

import { FilterBar } from "../../components/replay/filters/FilterBar";
import type { FilterDescriptor, FilterOption } from "../../components/replay/filters/types";

function option(value: string, sessionCount = 5, replayCount = 3): FilterOption {
  return { value, label: value, description: null, sessionCount, replayCount };
}

// One work domain in the whole org: the company axis has nothing to choose between, so at rest
// the pill is an absence rather than an empty state (E11).
const ONE_COMPANY: FilterDescriptor = {
  param: "company",
  restLabel: "All companies",
  kind: "list",
  panelSize: [320, 326],
  searchPlaceholder: "acme.com",
  footNote: "Personal addresses (gmail, yahoo) aren't companies, so they're not listed.",
  options: [option("acme.com")],
  value: null,
  summarise: (value: string) => `Company: ${value}`,
  clearLabel: "Clear the company filter",
};

const ENTRY: FilterDescriptor = {
  param: "entry",
  restLabel: "All pages",
  kind: "list",
  panelSize: [320, 326],
  searchPlaceholder: "/pricing",
  footNote: "The page someone landed on first, not every page they saw.",
  options: [option("/pricing", 4, 2), option("/docs", 3, 1)],
  value: null,
  summarise: (value: string) => `Entry page: ${value}`,
  clearLabel: "Clear the page filter",
};

const WHO: FilterDescriptor = {
  param: "who",
  restLabel: "Real people",
  kind: "segment",
  panelSize: [300, 224],
  searchPlaceholder: null,
  footNote: null,
  options: [
    {
      value: "real",
      label: "Real people",
      description: "Not your team, not automation",
      sessionCount: 11,
      replayCount: 7,
    },
    {
      value: "simulated",
      label: "Simulated",
      description: "Audience runs from before launch",
      sessionCount: 2,
      replayCount: 0,
    },
    {
      value: "excluded",
      label: "Excluded",
      description: "And why each one was",
      sessionCount: 4,
      replayCount: 2,
    },
  ],
  value: null,
  summarise: (value: string) => `Who counts: ${value}`,
  clearLabel: "Show real people again",
};

function barMarkup(descriptors: readonly FilterDescriptor[]): string {
  return renderToStaticMarkup(
    createElement(
      MantineProvider,
      { theme },
      createElement(FilterBar, { descriptors, onApply: () => undefined }),
    ),
  );
}

function pillLabels(markup: string): readonly string[] {
  const found: string[] = [];

  for (const match of markup.matchAll(/<button[^>]*aria-haspopup="dialog"[^>]*>/g)) {
    found.push(/aria-label="([^"]*)"/.exec(match[0] ?? "")?.[1] ?? "");
  }

  return found;
}

describe("which pills render", () => {
  test("a descriptor with one option and no URL value renders no pill", () => {
    const markup = barMarkup([ONE_COMPANY, ENTRY, WHO]);

    expect(pillLabels(markup)).toHaveLength(2);
    // The rest label is the pill's whole visible text, so its absence is the pill's absence.
    expect(markup).not.toContain("All companies");
  });

  // R-5. A pasted ?company= that applied a filter with no control to clear it is the dead-end
  // class this repo shipped once on /first-run.
  test("a descriptor with one option whose URL param carries a value renders its pill, accented and clearable", () => {
    const markup = barMarkup([{ ...ONE_COMPANY, value: "acme.com" }, ENTRY, WHO]);

    expect(
      pillLabels(markup).filter((label) => label.startsWith("Company: acme.com")),
    ).toHaveLength(1);
    // Accented: the applied pill is the filled variant, never the resting one.
    expect(markup).toMatch(
      /<button[^>]*aria-label="Company: acme\.com[^"]*"[^>]*data-variant="filled"/,
    );
    // And escapable: its own button, its own tab stop.
    expect(markup).toMatch(/<button[^>]*aria-label="Clear the company filter"/);
  });

  // A value no option row carries still renders its pill (E5), for the same reason.
  test("a value matching no option still renders its pill", () => {
    const markup = barMarkup([
      { ...ONE_COMPANY, options: [], value: "orbitlabs.co.uk" },
      ENTRY,
      WHO,
    ]);

    expect(
      pillLabels(markup).filter((label) => label.startsWith("Company: orbitlabs.co.uk")),
    ).toHaveLength(1);
    expect(markup).toMatch(/<button[^>]*aria-label="Clear the company filter"/);
  });

  test("losing the company pill leaves the entry and who pills rendered", () => {
    const markup = barMarkup([ONE_COMPANY, ENTRY, WHO]);

    // Per-descriptor, never all-or-nothing: the stated baseline stays on screen (P-2), which is
    // the one thing collapsing the bar behind a single "Filters" control would have hidden.
    expect(markup).toContain("All pages");
    expect(markup).toContain("Real people");
    expect(pillLabels(markup)).toHaveLength(2);
  });
});
