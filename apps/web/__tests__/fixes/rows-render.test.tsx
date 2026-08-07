// The ranking disclosure is the reason the read model carries the value it was ranked by,
// so it has to be reachable: the control is a button that says what it owns, and the title
// beside it stays a link. A div with a click handler would pass every other gate here.
import { MantineProvider } from "@mantine/core";
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { FixRows } from "../../components/fixes/FixRows";
import { theme } from "../../lib/theme";
import type { FixRowView } from "../../lib/fixes/view";

const ROWS: readonly FixRowView[] = [
  {
    fixId: "fix-a",
    href: "/fixes/fix-a",
    rank: 1,
    summary: "People are dropping out on the page where they pay.",
    count: "12 of 340 sessions",
    due: { late: false, value: "17 August 2026", label: "result due" },
    why: {
      lead: "First because 12 of 340 sessions measured ran into this.",
      roleNote: "This is where people pay.",
      arithmetic: "12 sessions × 8 = 96",
      against: null,
      unroled: false,
    },
  },
  {
    fixId: "fix-b",
    href: "/fixes/fix-b",
    rank: 2,
    summary: "People keep coming back to the same help page inside one visit.",
    count: "58 of 610 sessions",
    due: { late: true, value: "no answer", label: "since 10 August 2026" },
    why: {
      lead: "Second, even though 58 sessions ran into this — more than anything else here.",
      roleNote: "Nothing has been said about what this page is for.",
      arithmetic: "58 sessions × 1 = 58",
      against: "Above it: 12 sessions × 8 = 96.",
      unroled: true,
    },
  },
];

// React's useId prefix is not stable across versions, so the linkage is read back out of
// the markup rather than reconstructed.
function panelIdIn(html: string, fixId: string): string {
  const found = new RegExp(`id="([^"]*-${fixId})"`).exec(html);
  if (found === null) throw new Error(`no panel rendered for ${fixId}`);
  return found[1];
}

function markup(): string {
  return renderToStaticMarkup(
    createElement(MantineProvider, { theme }, createElement(FixRows, { rows: ROWS })),
  );
}

describe("the ranked stack", () => {
  const html = markup();

  test("the why control is a button that declares the panel it owns", () => {
    expect(html).toContain('aria-expanded="false"');
    expect(html.match(/<button[^>]*aria-controls=/g)?.length).toBe(ROWS.length);
  });

  test("the row title stays a link, so it is not swallowed by the disclosure", () => {
    expect(html).toContain('href="/fixes/fix-a"');
    expect(html).toContain('href="/fixes/fix-b"');
  });

  test("every count carries its denominator, and the role is the product's own sentence", () => {
    expect(html).toContain("12 of 340 sessions");
    expect(html).toContain("Nothing has been said about what this page is for.");
  });

  test("a row past its promised date states it rather than counting down", () => {
    expect(html).toContain("no answer");
    expect(html).toContain("since 10 August 2026");
    expect(html).not.toMatch(/\b\d+ days? (?:ago|left)\b/);
  });

  test("the panel each control names exists and is hidden until it is asked for", () => {
    for (const row of ROWS) {
      expect(html).toContain(`aria-controls="${panelIdIn(html, row.fixId)}"`);
      expect(html).toContain(`id="${panelIdIn(html, row.fixId)}"`);
    }
    expect(html.match(/aria-hidden="true"/g)?.length).toBe(ROWS.length);
  });

  test("a late row is marked in the theme's own colour rather than a hand-picked one", () => {
    expect(html).toContain("var(--mantine-color-stamp-4)");
  });
});
