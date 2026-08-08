import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";
import { MantineProvider } from "@mantine/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { theme } from "@/lib/theme";
import { tapTargetStyle } from "@/components/ui/tap-target";

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

// A thirty-character path is the value §13 names: it is what makes a fixed-width pill overflow.
const LONG_PATH = "/onboarding/step-2/confirm-plan";

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
      value: "orbitlabs.co.uk",
      label: "orbitlabs.co.uk",
      description: null,
      sessionCount: 2,
      replayCount: 1,
    },
  ],
  value: null,
  axis: "Company",
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
    { value: LONG_PATH, label: LONG_PATH, description: null, sessionCount: 4, replayCount: 2 },
    { value: "/pricing", label: "/pricing", description: null, sessionCount: 3, replayCount: 1 },
  ],
  value: LONG_PATH,
  axis: "Entry page",
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
  axis: "Who counts",
  clearLabel: "Show real people again",
};

function stylesheet(): string {
  return readFileSync(STYLESHEET, "utf8");
}

function barMarkup(): string {
  return renderToStaticMarkup(
    createElement(
      MantineProvider,
      { theme },
      createElement(FilterBar, {
        descriptors: [COMPANY, ENTRY, WHO],
        onApply: () => undefined,
      }),
    ),
  );
}

function panelMarkup(descriptor: FilterDescriptor): string {
  return renderToStaticMarkup(
    createElement(
      MantineProvider,
      { theme },
      createElement(FilterPanel, {
        descriptor,
        onPick: () => undefined,
        onDismiss: () => undefined,
      }),
    ),
  );
}

function styleAttributes(markup: string, elementPattern: RegExp): readonly string[] {
  return [...markup.matchAll(elementPattern)].map(
    (match) => /style="([^"]*)"/.exec(match[0] ?? "")?.[1] ?? "",
  );
}

describe("375px", () => {
  test("all three pills render at 375px with the panel as a bottom sheet and no horizontal scroll", () => {
    const markup = barMarkup();

    // Collapsing the bar behind one "Filters" control would hide the stated baseline, which is
    // the one thing State 1 exists to keep on screen.
    expect(markup).toContain("All companies");
    expect(markup).toContain("Real people");
    expect(markup).toContain(LONG_PATH);

    const source = stylesheet();

    // Wrap rather than scroll, and never a fixed pill width: R-7 is what keeps a 31-character
    // applied path inside the viewport.
    expect(source).toMatch(/flex-wrap\s*:\s*wrap/);
    expect(source).not.toMatch(/width\s*:\s*172px/);
    expect(source).not.toMatch(/width\s*:\s*148px/);
    expect(source).not.toMatch(/overflow-x\s*:\s*(auto|scroll)/);
    expect(source).toMatch(/max-width\s*:\s*100%/);

    // The sheet, not the morph, below 640px.
    expect(source).toMatch(/@media[^{]*max-width[^{]*(640px|39\.99|40em)/);
    expect(source).toMatch(/position\s*:\s*fixed/);
  });

  // R-8 as ruled: the 36px visual height stays on a fine pointer and the 44px floor arrives from
  // a coarse-pointer block. `tapTargetStyle` is NOT the mechanism for this control — spreading it
  // inline sets min-height 44 unconditionally and makes every pill 44px tall on a desktop, which
  // is the ruling it would break. It stays the mechanism for controls with no fine-pointer size.
  test("every pill, clear control, panel row and empty-state button has a 44px hit area on a coarse pointer", () => {
    const bar = barMarkup();
    const panel = panelMarkup(COMPANY);

    const pills = styleAttributes(bar, /<button[^>]*aria-haspopup="dialog"[^>]*>/g);
    const clears = styleAttributes(bar, /<button[^>]*aria-label="Clear the [^"]*"[^>]*>/g);
    const rows = styleAttributes(panel, /<[a-z]+[^>]*role="option"[^>]*>/g);

    expect(pills.length).toBeGreaterThan(0);
    expect(clears.length).toBeGreaterThan(0);
    expect(rows.length).toBeGreaterThan(0);

    const floor = `${String(tapTargetStyle.minHeight)}px`;

    for (const style of [...pills, ...clears, ...rows]) {
      // Unconditionally inline would be the R-8 break, not the R-8 fix.
      expect(style).not.toContain(`min-height:${floor}`);
    }

    // A coarse pointer and the narrow breakpoint both raise it to the floor, and neither is
    // reachable through getComputedStyle here: happy-dom emulates no media feature, and a CSS
    // module never reaches the document under `bun test`. The declaration is the assertion.
    const source = stylesheet();
    const coarse = /@media[^{]*pointer\s*:\s*coarse[^{]*\{([\s\S]*?)\n\}/.exec(source)?.[1] ?? "";

    expect(coarse).not.toBe("");
    expect(coarse).toContain(`min-height: ${floor}`);
    expect(source).toMatch(/touch-action\s*:\s*manipulation/);

    // And the fine-pointer size the ruling preserves.
    expect(source).toMatch(/min-height\s*:\s*36px|height\s*:\s*36px/);
  });
});
