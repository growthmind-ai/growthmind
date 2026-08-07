import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";
import { MantineProvider } from "@mantine/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { FilterPanel } from "../../components/replay/filters/FilterPanel";
import type { FilterDescriptor } from "../../components/replay/filters/types";

const FILTERS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "components",
  "replay",
  "filters",
);

// The engine is what drives any descriptor. `descriptors.ts` is where the three filter
// identities are allowed to be named, and `filter-url.ts` writes params from the shared
// constants — neither is the engine, and neither is swept here.
const ENGINE_MODULES = ["FilterBar.tsx", "FilterPanel.tsx", "types.ts"] as const;

// V-3: the `kind` values "list" and "segment" are exempt. `kind` is generic descriptor
// vocabulary and the engine must branch on it to render a radio group rather than a listbox.
const FORBIDDEN = ["company", "entry", "domain", "lane", "who", "whoCounts"] as const;

const NO_DOM =
  "apps/web has no DOM renderer and no Testing Library, so this row cannot be asserted at the rendered value";

function descriptor(overrides: Partial<FilterDescriptor> = {}): FilterDescriptor {
  return {
    param: "shade",
    restLabel: "All shades",
    kind: "list",
    panelSize: [320, 326],
    searchPlaceholder: "sea green",
    footNote: null,
    options: [
      {
        value: "sea-green",
        label: "sea green",
        description: null,
        sessionCount: 4,
        replayCount: 2,
      },
      { value: "slate", label: "slate", description: null, sessionCount: 1, replayCount: 0 },
    ],
    value: null,
    summarise: (value: string) => `Shade: ${value}`,
    clearLabel: "Clear the shade filter",
    ...overrides,
  };
}

function panelMarkup(given: FilterDescriptor): string {
  return renderToStaticMarkup(
    createElement(
      MantineProvider,
      null,
      createElement(FilterPanel, {
        descriptor: given,
        onPick: () => undefined,
        onDismiss: () => undefined,
      }),
    ),
  );
}

function dialogStyle(markup: string): string {
  const dialog = /<[a-z]+[^>]*role="dialog"[^>]*>/i.exec(markup)?.[0] ?? "";
  return /style="([^"]*)"/.exec(dialog)?.[1] ?? "";
}

describe("the filter engine learns nothing about the filters it drives", () => {
  test("the engine source names no filter", () => {
    const offenders: string[] = [];

    for (const engineModule of ENGINE_MODULES) {
      const source = readFileSync(path.join(FILTERS_DIR, engineModule), "utf8");

      for (const term of FORBIDDEN) {
        if (new RegExp(`\\b${term}\\b`).test(source)) offenders.push(`${engineModule}: ${term}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  test("the engine reads panel size from the descriptor", () => {
    // Company and entry are deliberately the same size (R-1): the proof the engine generalises
    // is that a different accessor needs no new size. The segment is the one that differs.
    expect(dialogStyle(panelMarkup(descriptor({ kind: "list", panelSize: [320, 326] })))).toContain(
      "width:320px",
    );
    expect(dialogStyle(panelMarkup(descriptor({ kind: "list", panelSize: [320, 326] })))).toContain(
      "height:326px",
    );

    const segment = dialogStyle(
      panelMarkup(descriptor({ kind: "segment", panelSize: [300, 224], searchPlaceholder: null })),
    );
    expect(segment).toContain("width:300px");
    expect(segment).toContain("height:224px");
  });

  test("a fourth test-only descriptor opens its panel at its own size with no engine edit", () => {
    // A size no shipped descriptor uses, so a hard-coded 320 or 300 in the engine fails here.
    const fourth = descriptor({ param: "shade", panelSize: [264, 188] });
    const markup = panelMarkup(fourth);

    expect(dialogStyle(markup)).toContain("width:264px");
    expect(dialogStyle(markup)).toContain("height:188px");
    expect(markup).toContain("sea green");
    expect(markup).toContain("slate");
  });

  // Needs an event fired at a mounted component. apps/web has no DOM renderer and no Testing
  // Library, and this suite will not fake one — see the wave report.
  test.todo(
    "a fourth test-only descriptor drives the engine with no engine edit (picking applies)",
    () => {
      throw new Error(NO_DOM);
    },
  );
});
