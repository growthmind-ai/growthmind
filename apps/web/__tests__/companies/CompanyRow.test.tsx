// Wave 0 red for ADD O-039 D-8 (apps/web/components/companies/CompanyRow.tsx — the pure
// per-account row, styled like ReplayRow.tsx). No component exists yet.
import { describe, expect, test } from "bun:test";
import { MantineProvider } from "@mantine/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CompanyRow } from "../../components/companies/CompanyRow";
import { ROUTES } from "../../lib/routes";
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
    sessionCount: 7,
    mostRecentSessionAt: "2026-08-05T06:27:54.726Z",
    ...overrides,
  };
}

function markup(companyGroup: CompanyGroupDTO): string {
  return renderToStaticMarkup(
    createElement(MantineProvider, null, createElement(CompanyRow, { group: companyGroup })),
  );
}

function hrefOf(html: string): string | null {
  return /href="([^"]+)"/.exec(html)?.[1] ?? null;
}

describe("CompanyRow", () => {
  test("renders the domain and links to that domain's detail route", () => {
    const html = markup(group({ domain: "acme.example" }));

    expect(readMarkup(html).text).toContain("acme.example");
    expect(hrefOf(html)).toBe(ROUTES.companyDetail.replace("[domain]", "acme.example"));
  });

  test("shows the plural session count for more than one session", () => {
    const text = readMarkup(markup(group({ sessionCount: 7 }))).text;

    expect(text).toContain("7 sessions");
  });

  test("shows the singular form for exactly one session, never the plural", () => {
    const text = readMarkup(markup(group({ sessionCount: 1 }))).text;

    expect(text).toContain("1 session");
    expect(text).not.toContain("1 sessions");
  });
});
