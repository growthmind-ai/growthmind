import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, test } from "bun:test";
import { MantineProvider } from "@mantine/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";

import { FilterBar } from "../../components/replay/filters/FilterBar";
import { FilterPanel } from "../../components/replay/filters/FilterPanel";
import type { FilterDescriptor } from "../../components/replay/filters/types";
import { nameOf } from "./helpers/names";

const STYLESHEET = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "components",
  "replay",
  "filters",
  "filter-bar.module.css",
);

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

interface PanelHarness {
  readonly html: string;
  readonly picked: readonly string[];
}

function renderPanel(descriptor: FilterDescriptor): PanelHarness {
  const picked: string[] = [];

  const { container } = render(
    createElement(
      MantineProvider,
      null,
      createElement(FilterPanel, {
        descriptor,
        onPick: (value: string) => picked.push(value),
        onDismiss: () => undefined,
      }),
    ),
  );

  return { html: container.innerHTML, picked };
}

function renderBar(descriptors: readonly FilterDescriptor[]) {
  const applied: Array<readonly [string, string]> = [];

  const { container } = render(
    createElement(
      MantineProvider,
      null,
      createElement(FilterBar, {
        descriptors,
        onApply: (param: string, value: string) => applied.push([param, value]),
      }),
    ),
  );

  return { container, applied };
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

afterEach(cleanup);

describe("the filter panel", () => {
  test("a zero-session option row renders at full opacity with its state in the count text and stays clickable", async () => {
    const picked: string[] = [];

    render(
      createElement(
        MantineProvider,
        null,
        createElement(FilterPanel, {
          descriptor: COMPANY,
          onPick: (value: string) => picked.push(value),
          onDismiss: () => undefined,
        }),
      ),
    );

    const row = screen.getByRole("option", { name: /northwind\.co/ });

    // The count is the state, at the dimmed colour — not a dimmed row. An unset opacity is full
    // opacity, and happy-dom reports unset as the empty string.
    expect(["", "1"]).toContain(getComputedStyle(row).opacity);
    expect(row.textContent).toContain("0 · 0 replays");

    // In the tab order, and its accessible name carries the counts a screen reader needs.
    expect(row.getAttribute("tabindex")).not.toBe("-1");
    expect(row.getAttribute("aria-disabled")).not.toBe("true");
    expect(nameOf(document.body, row)).toBe("northwind.co, 0 sessions, 0 replays");

    // Pickable is not a styling claim: taking the row applies it.
    await userEvent.click(row);
    expect(picked).toEqual(["northwind.co"]);
  });

  test("no opacity magnitude appears on an option row", () => {
    const rendered = renderedOpacities(renderPanel(COMPANY).html);
    expect(rendered.filter((value) => Number(value) !== 1)).toEqual([]);

    // A CSS module never reaches the document under `bun test`, so a magnitude hidden in the
    // stylesheet is invisible to getComputedStyle. The file is read directly for that reason.
    const declared: string[] = [];
    for (const match of readFileSync(STYLESHEET, "utf8").matchAll(OPACITY)) {
      declared.push(match[1] ?? "");
    }
    expect(declared.filter((value) => Number(value) !== 1)).toEqual([]);
  });

  test("the panel search input carries an example placeholder, not a restatement of its label", () => {
    expect(renderPanel(COMPANY).html).toContain('placeholder="acme.com"');
    cleanup();
    expect(renderPanel(ENTRY).html).toContain('placeholder="/pricing"');

    // A restatement would read the label back at the user and tell them nothing about the shape.
    cleanup();
    const company = renderPanel(COMPANY).html;
    expect(company).not.toContain('placeholder="Choose a company"');
    expect(company).not.toContain('placeholder="Search companies"');
  });

  test("a query matching nothing renders a sentence and a wired clear control at the panel's fixed height", async () => {
    render(
      createElement(
        MantineProvider,
        null,
        createElement(FilterPanel, {
          descriptor: COMPANY,
          onPick: () => undefined,
          onDismiss: () => undefined,
        }),
      ),
    );

    const before = screen.getByRole("dialog").getAttribute("style");

    await userEvent.type(screen.getByPlaceholderText("acme.com"), "zzz");

    // A sentence, not a blank box.
    expect(screen.getByText('Nothing matches "zzz".')).toBeDefined();
    expect(screen.queryAllByRole("option")).toHaveLength(0);

    // The surface must not re-morph mid-type.
    expect(screen.getByRole("dialog").getAttribute("style")).toBe(before);

    // And the affordance is a real control, wired — a-form-ships-complete.
    await userEvent.click(screen.getByRole("button", { name: /clear the search/i }));
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  test("the segment panel is a real radio group with a legend", () => {
    const { html } = renderPanel(WHO);

    expect(html).toContain("<fieldset");
    expect(html).toContain("<legend");
    expect(screen.getByText("Who counts")).toBeDefined();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    // No search on a segment: three rows do not need finding.
    expect(html).not.toContain('type="search"');
  });

  test("the pill and its clear control are two buttons with two tab stops", () => {
    const { container } = renderBar([{ ...COMPANY, value: "acme.com" }, ENTRY, WHO]);

    // Two actions, two buttons — never a click zone inside the pill.
    const clear = container.querySelector('button[aria-label="Clear the company filter"]');
    expect(clear).not.toBeNull();
    expect(clear?.tagName).toBe("BUTTON");

    const pill = container.querySelector('button[aria-haspopup="dialog"]');
    expect(pill).not.toBeNull();
    expect(pill?.getAttribute("aria-expanded")).toBe("false");
    expect(nameOf(container, pill as Element)).toContain("Company: acme.com");
    expect(pill).not.toBe(clear);
  });

  test("dismissing a panel does not clear its filter", async () => {
    const { container, applied } = renderBar([{ ...COMPANY, value: "acme.com" }, ENTRY, WHO]);
    const pill = container.querySelector('button[aria-haspopup="dialog"]') as HTMLElement;

    await userEvent.click(pill);
    expect(screen.getByRole("dialog")).toBeDefined();

    await userEvent.keyboard("{Escape}");

    // Closes, returns focus to the pill, and changes nothing — dismiss is not clearing (T9).
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(pill);
    expect(applied).toEqual([]);
    expect(nameOf(container, pill)).toContain("Company: acme.com");
  });
});
