// Wave 0 red for ADD O-039 D-8 (apps/web/components/companies/CompanySessionsBody.tsx — the
// render-pure, hook-free session-list body for the /companies/[domain] detail page). No
// component exists yet. `not_found` is a real Load member here with no list-page equivalent:
// the detail route's 200 response never carries zero sessions (ADD D-5).
import { describe, expect, test } from "bun:test";
import { MantineProvider } from "@mantine/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { COMPANY_DETAIL_NOT_FOUND, COMPANY_SESSIONS_TRUNCATED } from "@growthmind/shared";

import { CompanySessionsBody, type Load } from "../../components/companies/CompanySessionsBody";
import { readMarkup } from "../first-run/helpers/rendered-markup";

// Mirrors ADD D-6/D-7's CompanySessionStory / CompanySessionDTO (apps/web/lib/companies/dto.ts,
// not yet built) — declared locally so this fixture doesn't chain a second not-yet-existing
// import.
type CompanySessionStory =
  | { readonly kind: "resolved"; readonly headline: string; readonly context: readonly string[] }
  | { readonly kind: "held" }
  | { readonly kind: "pending" }
  | { readonly kind: "no_recording" };

interface CompanySessionDTO {
  readonly sessionId: string;
  readonly startedAt: string;
  readonly entryUrlPath: string | null;
  readonly recordingId: string | null;
  readonly story: CompanySessionStory;
}

function session(overrides: Partial<CompanySessionDTO> = {}): CompanySessionDTO {
  return {
    sessionId: "sess-0001",
    startedAt: "2026-08-05T06:27:54.726Z",
    entryUrlPath: "/pricing",
    recordingId: "rec-0001",
    story: { kind: "pending" },
    ...overrides,
  };
}

// Every fixture above names a real, non-null entryUrlPath, so it can double as the row's own
// text marker — `toContain` needs `string`, not the DTO's `string | null`.
function pathOf(companySession: CompanySessionDTO): string {
  if (companySession.entryUrlPath === null) throw new Error("fixture must name an entryUrlPath");
  return companySession.entryUrlPath;
}

function render(load: Load): string {
  return renderToStaticMarkup(
    createElement(MantineProvider, null, createElement(CompanySessionsBody, { load })),
  );
}

describe("CompanySessionsBody", () => {
  test("loading renders the two-skeleton placeholder", () => {
    const html = render({ state: "loading" });

    expect([...html.matchAll(/mantine-Skeleton-root/g)]).toHaveLength(2);
  });

  test("not_found renders COMPANY_DETAIL_NOT_FOUND, never a session row", () => {
    const html = render({ state: "not_found" });
    const card = readMarkup(html);

    expect(card.text).toContain(COMPANY_DETAIL_NOT_FOUND);
    expect(card.controls).toEqual([]);
  });

  test("failed renders the carried message, not the not-found copy", () => {
    const html = render({ state: "failed", message: "could not reach it just now" });
    const text = readMarkup(html).text;

    expect(text).toContain("could not reach it just now");
    expect(text).not.toContain(COMPANY_DETAIL_NOT_FOUND);
  });

  test("ready with one session renders it and no truncation note", () => {
    const html = render({
      state: "ready",
      sessions: [session({ entryUrlPath: "/only-one" })],
      truncated: false,
    });
    const text = readMarkup(html).text;

    expect(text).toContain("/only-one");
    expect(text).not.toContain(COMPANY_SESSIONS_TRUNCATED);
  });

  test("ready with many sessions and truncated:true renders every row plus the truncation note", () => {
    const sessions = [
      session({ sessionId: "one", entryUrlPath: "/path-a" }),
      session({ sessionId: "two", entryUrlPath: "/path-b" }),
      session({ sessionId: "three", entryUrlPath: "/path-c" }),
    ];
    const html = render({ state: "ready", sessions, truncated: true });
    const text = readMarkup(html).text;

    for (const s of sessions) {
      expect(text).toContain(pathOf(s));
    }
    expect(text).toContain(COMPANY_SESSIONS_TRUNCATED);
  });
});
