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

// A filter no shipped descriptor declares, at a size no shipped descriptor uses: a hard-coded
// 320 or 300 in the engine fails here, and so does a branch on which filter is open.
function fourthDescriptor(overrides: Partial<FilterDescriptor> = {}): FilterDescriptor {
  return {
    param: "shade",
    restLabel: "All shades",
    kind: "list",
    panelSize: [264, 188],
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

function inProvider(node: ReturnType<typeof createElement>) {
  return createElement(MantineProvider, null, node);
}

function dialogStyle(markup: string): string {
  const dialog = /<[a-z]+[^>]*role="dialog"[^>]*>/i.exec(markup)?.[0] ?? "";
  return /style="([^"]*)"/.exec(dialog)?.[1] ?? "";
}

function panelOnly(descriptor: FilterDescriptor): string {
  const { container } = render(
    inProvider(
      createElement(FilterPanel, {
        descriptor,
        onPick: () => undefined,
        onDismiss: () => undefined,
      }),
    ),
  );

  return container.innerHTML;
}

afterEach(cleanup);

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
    const list = dialogStyle(panelOnly(fourthDescriptor({ panelSize: [320, 326] })));
    expect(list).toContain("width:320px");
    expect(list).toContain("height:326px");

    const segment = dialogStyle(
      panelOnly(
        fourthDescriptor({ kind: "segment", panelSize: [300, 224], searchPlaceholder: null }),
      ),
    );
    expect(segment).toContain("width:300px");
    expect(segment).toContain("height:224px");
  });

  test("a fourth test-only descriptor drives the engine with no engine edit", async () => {
    const applied: Array<readonly [string, string]> = [];
    const descriptor = fourthDescriptor();

    const { container } = render(
      inProvider(
        createElement(FilterBar, {
          descriptors: [descriptor],
          onApply: (param: string, value: string) => applied.push([param, value]),
        }),
      ),
    );

    const pill = container.querySelector('button[aria-haspopup="dialog"]');
    expect(pill).not.toBeNull();

    await userEvent.click(pill as Element);

    // Opens at its own size, which no shipped descriptor uses.
    const panel = screen.getByRole("dialog");
    expect(panel.getAttribute("style") ?? "").toContain("width:264px");
    expect(panel.getAttribute("style") ?? "").toContain("height:188px");

    // And picking applies — the whole extensibility claim, executed rather than asserted.
    await userEvent.click(screen.getByRole("option", { name: /sea green/i }));

    expect(applied).toEqual([["shade", "sea-green"]]);
  });
});
