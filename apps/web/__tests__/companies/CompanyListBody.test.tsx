// Wave 0 red for ADD O-039 D-8 (apps/web/components/companies/CompanyListBody.tsx — the
// render-pure, hook-free list body). No DOM renderer in this repo, so every fixture below is
// `renderToStaticMarkup` from props alone, mirroring ReplayRow's own test and AgentPanelBody's
// (test-requirements.md; ADD D-8).
import { describe, expect, test } from "bun:test";
import { MantineProvider } from "@mantine/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { COMPANY_LIST_NONE_YET, COMPANY_LIST_TRUNCATED } from "@growthmind/shared";

import { CompanyListBody, type Load } from "../../components/companies/CompanyListBody";
import { readMarkup } from "../first-run/helpers/rendered-markup";

// Mirrors ADD D-7's CompanyGroupDTO (apps/web/lib/companies/dto.ts, not yet built) — declared
// locally so this fixture doesn't chain a second not-yet-existing import.
interface CompanyGroupDTO {
  readonly domain: string;
  readonly sessionCount: number;
  readonly mostRecentSessionAt: string;
}

function group(overrides: Partial<CompanyGroupDTO> = {}): CompanyGroupDTO {
  return {
    domain: "acme.example",
    sessionCount: 3,
    mostRecentSessionAt: "2026-08-05T06:27:54.726Z",
    ...overrides,
  };
}

function render(load: Load): string {
  return renderToStaticMarkup(
    createElement(MantineProvider, null, createElement(CompanyListBody, { load })),
  );
}

describe("CompanyListBody", () => {
  test("loading renders the two-skeleton placeholder, not any row or message", () => {
    const html = render({ state: "loading" });
    const text = readMarkup(html).text;

    expect([...html.matchAll(/mantine-Skeleton-root/g)]).toHaveLength(2);
    expect(text).not.toContain(COMPANY_LIST_NONE_YET);
  });

  test("ready with zero groups renders the none-yet empty state and no rows", () => {
    const html = render({ state: "ready", groups: [], truncated: false });
    const card = readMarkup(html);

    expect(card.text).toContain(COMPANY_LIST_NONE_YET);
    expect(card.controls).toEqual([]);
  });

  test("ready with one group renders that domain and no truncation note", () => {
    const html = render({
      state: "ready",
      groups: [group({ domain: "acme.example" })],
      truncated: false,
    });
    const text = readMarkup(html).text;

    expect(text).toContain("acme.example");
    expect(text).not.toContain(COMPANY_LIST_TRUNCATED);
  });

  test("ready with many groups and truncated:true renders every row plus the truncation note", () => {
    const groups = [
      group({ domain: "acme.example" }),
      group({ domain: "initech.example" }),
      group({ domain: "globex.example" }),
    ];
    const html = render({ state: "ready", groups, truncated: true });
    const text = readMarkup(html).text;

    for (const g of groups) {
      expect(text).toContain(g.domain);
    }
    expect(text).toContain(COMPANY_LIST_TRUNCATED);
  });

  test("failed renders the carried message, never the empty-state copy", () => {
    const html = render({ state: "failed", message: "custom failure text" });
    const text = readMarkup(html).text;

    expect(text).toContain("custom failure text");
    expect(text).not.toContain(COMPANY_LIST_NONE_YET);
  });
});
