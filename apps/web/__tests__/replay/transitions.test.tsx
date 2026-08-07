import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";
import { MantineProvider } from "@mantine/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { theme } from "@/lib/theme";

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

const WHO_AT_BASELINE: FilterDescriptor = {
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

// The reduced-motion block, and everything outside it, as two strings. Nothing in this harness
// can run a cascade, so the declaration is the strongest available reading of what ships.
function motionHalves(): { readonly reduced: string; readonly rest: string } {
  const source = stylesheet();
  const start = source.search(/@media[^{]*prefers-reduced-motion\s*:\s*reduce[^{]*\{/);

  if (start === -1) return { reduced: "", rest: source };

  let depth = 0;
  let index = source.indexOf("{", start);
  const open = index;

  while (index < source.length) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
    index += 1;
  }

  return {
    reduced: source.slice(open + 1, index),
    rest: source.slice(0, start) + source.slice(index + 1),
  };
}

function ruleFor(source: string, selectorFragment: string): string {
  const pattern = new RegExp(`\\.[A-Za-z-]*${selectorFragment}[A-Za-z-]*[^{]*\\{([^}]*)\\}`, "gi");
  return [...source.matchAll(pattern)].map((match) => match[1] ?? "").join(" ");
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

function barMarkup(descriptors: readonly FilterDescriptor[]): string {
  return renderToStaticMarkup(
    createElement(
      MantineProvider,
      { theme },
      createElement(FilterBar, { descriptors, onApply: () => undefined }),
    ),
  );
}

describe("the four stillnesses", () => {
  // T3. Per-keystroke motion reads as input lag, and a surface that resizes under the cursor
  // while you type is the worst version of this control.
  test("the search row swap carries no transition", () => {
    const { rest } = motionHalves();

    expect(ruleFor(rest, "option")).not.toContain("transition");
    expect(ruleFor(rest, "option")).not.toContain("animation");
    // The panel is height-fixed, so the surface never re-morphs mid-type.
    expect(panelMarkup(COMPANY)).toContain("height:326px");
  });

  // T7. The recount is not an event the user caused; it is the panel telling the truth about
  // the filters already on.
  test("a recomputed option count carries no transition", () => {
    const { rest } = motionHalves();

    expect(ruleFor(rest, "count")).not.toContain("transition");
    expect(ruleFor(rest, "count")).not.toContain("animation");
  });

  // T10. Accenting the default lane tells the user they applied a filter they did not apply.
  test("the default lane pill renders with no accent and no clear control", () => {
    const markup = barMarkup([COMPANY, WHO_AT_BASELINE]);
    const pill =
      /<button[^>]*aria-haspopup="dialog"[^>]*>[\s\S]*?Real people/.exec(markup)?.[0] ?? "";

    expect(pill).not.toBe("");
    expect(pill).not.toContain('data-variant="filled"');
    expect(markup).not.toContain('aria-label="Show real people again"');
    expect(markup).not.toContain('aria-pressed="true"');
  });

  // T13. A person opening a colleague's link is arriving, not acting.
  test("the cold-load render carries no entry animation on the pills or the rows", () => {
    const markup = barMarkup([{ ...COMPANY, value: "acme.com" }, WHO_AT_BASELINE]);

    expect(markup).not.toMatch(/animation\s*:/);
    expect(markup).not.toMatch(/data-entering/);
    expect(markup).not.toMatch(/data-mounted/);
  });
});

describe("reduced motion", () => {
  test("every animated transition drops to 0ms under prefers-reduced-motion", () => {
    const { reduced, rest } = motionHalves();

    expect(reduced).not.toBe("");

    // Every property the stylesheet animates outside the block has to be named inside it.
    const animated = [...rest.matchAll(/transition\s*:\s*([^;}]+)/g)].map((match) =>
      (match[1] ?? "").trim(),
    );
    expect(animated.length).toBeGreaterThan(0);

    for (const value of animated) {
      // `transition: all` is banned outright, so every declaration names its properties.
      expect(value).not.toMatch(/^all\b/);
    }

    for (const declared of reduced.matchAll(/transition-duration\s*:\s*([^;}]+)/g)) {
      expect((declared[1] ?? "").trim()).toBe("0ms");
    }

    expect(reduced).toMatch(/transition-duration\s*:\s*0ms|transition\s*:\s*none/);
    expect(reduced).toMatch(/animation-duration\s*:\s*0ms|animation\s*:\s*none/);
  });
});
