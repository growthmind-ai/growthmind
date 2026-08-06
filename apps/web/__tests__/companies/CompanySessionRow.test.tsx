// Wave 0 red for ADD O-039 D-8 (apps/web/components/companies/CompanySessionRow.tsx — the pure
// per-session row, switching exhaustively on story.kind per ADD §6/§8 and UX §3.4's four-state
// table). No component exists yet.
import { describe, expect, test } from "bun:test";
import { MantineProvider } from "@mantine/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  COMPANY_SESSION_NO_RECORDING,
  RECORDING_SUMMARY_HELD,
  RECORDING_SUMMARY_PENDING,
} from "@growthmind/shared";

import { CompanySessionRow } from "../../components/companies/CompanySessionRow";
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

function session(story: CompanySessionStory, recordingId: string | null): CompanySessionDTO {
  return {
    sessionId: "sess-0001",
    startedAt: "2026-08-05T06:27:54.726Z",
    entryUrlPath: "/pricing",
    recordingId,
    story,
  };
}

function markup(companySession: CompanySessionDTO): string {
  return renderToStaticMarkup(
    createElement(MantineProvider, null, createElement(CompanySessionRow, { session: companySession })),
  );
}

const WATCH_LINK = "Watch this recording";

describe("CompanySessionRow", () => {
  test("resolved renders the narration headline, with a recording link", () => {
    const html = markup(
      session(
        { kind: "resolved", headline: "Signed up, then abandoned the pricing page", context: [] },
        "rec-0001",
      ),
    );
    const card = readMarkup(html);

    expect(card.text).toContain("Signed up, then abandoned the pricing page");
    expect(card.controls.some((control) => control.includes(WATCH_LINK))).toBe(true);
  });

  test("held renders RECORDING_SUMMARY_HELD, with a recording link", () => {
    const card = readMarkup(markup(session({ kind: "held" }, "rec-0002")));

    expect(card.text).toContain(RECORDING_SUMMARY_HELD);
    expect(card.controls.some((control) => control.includes(WATCH_LINK))).toBe(true);
  });

  test("pending renders RECORDING_SUMMARY_PENDING, with a recording link", () => {
    const card = readMarkup(markup(session({ kind: "pending" }, "rec-0003")));

    expect(card.text).toContain(RECORDING_SUMMARY_PENDING);
    expect(card.controls.some((control) => control.includes(WATCH_LINK))).toBe(true);
  });

  test("no_recording renders COMPANY_SESSION_NO_RECORDING, with no recording link", () => {
    const card = readMarkup(markup(session({ kind: "no_recording" }, null)));

    expect(card.text).toContain(COMPANY_SESSION_NO_RECORDING);
    expect(card.controls.some((control) => control.includes(WATCH_LINK))).toBe(false);
  });
});
