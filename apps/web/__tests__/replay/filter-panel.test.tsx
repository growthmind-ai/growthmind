import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";
import { MantineProvider } from "@mantine/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { FilterBar } from "../../components/replay/filters/FilterBar";
import { FilterPanel } from "../../components/replay/filters/FilterPanel";
import type { FilterDescriptor } from "../../components/replay/filters/types";

const STYLESHEET = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "components",
  "replay",
  "filters",
  "filter-bar.module.css",
);

const NO_DOM =
  "apps/web has no DOM renderer and no Testing Library, so this row cannot be asserted at the rendered value";

const OPACITY = /opacity\s*:\s*([\d.]+)/g;
const STYLE_ATTRIBUTE = /style="([^"]*)"/g;

// northwind.co holds sessions, but none of them at the entry page currently filtered — so it
// stays in the option list, reading its zeroes, pickable. R-2: the number is the signal.
const COMPANY: FilterDescriptor = {
  param: "company",
  restLabel: "All companies",
  kind: "list",
  panelSize: [320, 326],
  searchPlaceholder: "acme.com",
  footNote: "Personal addresses (gmail, yahoo) aren't companies, so they're not listed.",
  options: [
    { value: "acme.com", label: "acme.com", description: null, sessionCount: 5, replayCount: 3 },
    {
      value: "northwind.co",
      label: "northwind.co",
      description: null,
      sessionCount: 0,
      replayCount: 0,
    },
  ],
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
  options: [
    { value: "/pricing", label: "/pricing", description: null, sessionCount: 4, replayCount: 2 },
  ],
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

function panelMarkup(descriptor: FilterDescriptor): string {
  return renderToStaticMarkup(
    createElement(
      MantineProvider,
      null,
      createElement(FilterPanel, {
        descriptor,
        onPick: () => undefined,
        onDismiss: () => undefined,
      }),
    ),
  );
}

function barMarkup(descriptors: readonly FilterDescriptor[]): string {
  return renderToStaticMarkup(
    createElement(MantineProvider, null, createElement(FilterBar, { descriptors })),
  );
}

function renderedOpacities(markup: string): readonly string[] {
  const found: string[] = [];

  for (const attribute of markup.matchAll(STYLE_ATTRIBUTE)) {
    for (const declaration of (attribute[1] ?? "").matchAll(OPACITY)) {
      found.push(declaration[1] ?? "");
    }
  }

  return found;
}

function optionRow(markup: string, value: string): string {
  const pattern = new RegExp(`<[a-z]+[^>]*data-value="${value}"[^>]*>[\\s\\S]*?</[a-z]+>`, "i");
  return pattern.exec(markup)?.[0] ?? "";
}

describe("the filter panel", () => {
  test("a zero-session option row renders at full opacity with its state in the count text and stays clickable", () => {
    const markup = panelMarkup(COMPANY);
    const row = optionRow(markup, "northwind.co");

    expect(row).not.toBe("");
    // The count is the state, at the dimmed colour — not a dimmed row.
    expect(row).toContain("0 · 0 replays");
    expect(row).toMatch(/data-dimmed|c="dimmed"|mantine-Text-root[^"]*"[^>]*data-dimmed/);
    // Still in the tab order and still an option a screen reader can pick.
    expect(row).toMatch(/role="option"/);
    expect(row).not.toContain('aria-disabled="true"');
    expect(row).not.toContain("disabled");
    expect(renderedOpacities(row)).toEqual([]);
  });

  test("no opacity magnitude appears on an option row", () => {
    const rendered = renderedOpacities(panelMarkup(COMPANY));
    expect(rendered.filter((value) => Number(value) !== 1)).toEqual([]);

    // The prototype's magnitude cannot hide in the stylesheet either — it is not in the markup
    // because it is not anywhere. Any opacity declared here must be a full one.
    const declared: string[] = [];
    for (const match of readFileSync(STYLESHEET, "utf8").matchAll(OPACITY)) {
      declared.push(match[1] ?? "");
    }
    expect(declared.filter((value) => Number(value) !== 1)).toEqual([]);
  });

  test("the panel search input carries an example placeholder, not a restatement of its label", () => {
    expect(panelMarkup(COMPANY)).toContain('placeholder="acme.com"');
    expect(panelMarkup(ENTRY)).toContain('placeholder="/pricing"');

    // A restatement would read the label back at the user and tell them nothing about the shape.
    expect(panelMarkup(COMPANY)).not.toContain('placeholder="Choose a company"');
    expect(panelMarkup(COMPANY)).not.toContain('placeholder="Search companies"');
  });

  test("the segment panel is a real radio group with a legend", () => {
    const markup = panelMarkup(WHO);

    expect(markup).toContain("<fieldset");
    expect(markup).toContain("<legend");
    expect(markup).toContain("Who counts");
    expect(markup.match(/<input[^>]*type="radio"/g) ?? []).toHaveLength(3);
    // No search on a segment: three rows do not need finding.
    expect(markup).not.toContain('type="search"');
  });

  test("the pill and its clear control are two buttons with two tab stops", () => {
    const markup = barMarkup([{ ...COMPANY, value: "acme.com" }, ENTRY, WHO]);

    // Two actions, two buttons — never a click zone inside the pill.
    expect(markup).toContain('aria-label="Clear the company filter"');
    expect(markup).toMatch(/<button[^>]*aria-label="Clear the company filter"/);
    expect(markup).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-haspopup="dialog"/);
    expect(markup).toContain('aria-label="Company: acme.com');
  });

  // All three need an event fired at, or focus moved inside, a mounted component: apps/web has
  // no DOM renderer and no Testing Library. This suite will not fake one — see the wave report.
  test.todo("a zero-session option row's click handler fires", () => {
    throw new Error(NO_DOM);
  });
  test.todo(
    "a query matching nothing renders a sentence and a wired clear control at the panel's fixed height",
    () => {
      throw new Error(NO_DOM);
    },
  );
  test.todo(
    "dismissing a panel does not clear its filter (Escape, focus returns to the pill)",
    () => {
      throw new Error(NO_DOM);
    },
  );
});
