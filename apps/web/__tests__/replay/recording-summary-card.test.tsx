// Wave 0 red for ADD O-047 AD-4/AD-5/AD-8 (apps/web/components/replay/RecordingSummaryCard.tsx —
// the pure card switching exhaustively on story.kind). Neither the component nor the five new copy
// constants exist yet.
import { describe, expect, test } from "bun:test";
import { MantineProvider } from "@mantine/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  RECORDING_SUMMARY_HELD,
  RECORDING_SUMMARY_NOT_CONFIGURED,
  RECORDING_SUMMARY_NO_SOURCE,
  RECORDING_SUMMARY_NO_SOURCE_LINK,
  RECORDING_SUMMARY_PARTIAL,
  RECORDING_SUMMARY_PENDING,
  RECORDING_SUMMARY_READ_FAILED,
  RECORDING_SUMMARY_SOURCE_MESSAGES,
  type SummarySource,
} from "@growthmind/shared";

import { RecordingSummaryCard } from "../../components/replay/RecordingSummaryCard";
import { ROUTES } from "../../lib/routes";
import { readMarkup } from "../first-run/helpers/rendered-markup";

// Mirrors AD-4's RecordingSummaryStory (apps/web/lib/replay/summary-story.ts, not yet built) —
// declared locally so this fixture doesn't chain a second not-yet-existing import.
type RecordingSummaryStory =
  | {
      readonly kind: "resolved";
      readonly headline: string;
      readonly context: readonly string[];
      readonly summarySource: SummarySource;
      readonly partial: boolean;
    }
  | { readonly kind: "held" }
  | { readonly kind: "queued" }
  | { readonly kind: "no_source" }
  | { readonly kind: "not_configured" }
  | { readonly kind: "read_failed" };

function markup(story: RecordingSummaryStory): string {
  return renderToStaticMarkup(
    createElement(MantineProvider, null, createElement(RecordingSummaryCard, { story })),
  );
}

const HEADLINE = "They opened the pricing page and left without choosing a plan.";

const CONTEXT: readonly string[] = [
  "They scrolled to the bottom of the page twice.",
  "They never opened the plan comparison.",
];

const SUMMARY_SOURCE: SummarySource = "model_rendered";

const PROVENANCE = RECORDING_SUMMARY_SOURCE_MESSAGES[SUMMARY_SOURCE];

function resolved(partial: boolean): RecordingSummaryStory {
  return {
    kind: "resolved",
    headline: HEADLINE,
    context: CONTEXT,
    summarySource: SUMMARY_SOURCE,
    partial,
  };
}

const ALL_SIX: readonly RecordingSummaryStory[] = [
  { kind: "queued" },
  { kind: "no_source" },
  { kind: "not_configured" },
  { kind: "read_failed" },
  { kind: "held" },
  resolved(false),
];

// The refusal codes and vendor shapes the card must never print. `not_configured` here is the code,
// never the plain-English constant of the same subject.
const REFUSAL_OR_VENDOR = /no_connection|unreadable_credential|not_configured|429|req_/;

describe("RecordingSummaryCard", () => {
  test("queued renders the pending sentence and offers no link", () => {
    const card = readMarkup(markup({ kind: "queued" }));

    expect(card.text).toContain(RECORDING_SUMMARY_PENDING);
    expect(card.controls).toEqual([]);
  });

  test("no_source renders its sentence and links to settings", () => {
    const html = markup({ kind: "no_source" });
    const card = readMarkup(html);

    expect(card.text).toContain(RECORDING_SUMMARY_NO_SOURCE);
    expect(
      card.controls.some((control) => control.includes(RECORDING_SUMMARY_NO_SOURCE_LINK)),
    ).toBe(true);
    expect(html).toContain(`href="${ROUTES.settings}"`);
  });

  test("not_configured renders its sentence and offers no link", () => {
    const html = markup({ kind: "not_configured" });
    const card = readMarkup(html);

    expect(card.text).toContain(RECORDING_SUMMARY_NOT_CONFIGURED);
    expect(card.controls).toEqual([]);
    expect(html).not.toContain(`href="${ROUTES.settings}"`);
  });

  test("read_failed stops borrowing the pending sentence", () => {
    const card = readMarkup(markup({ kind: "read_failed" }));

    expect(card.text).toContain(RECORDING_SUMMARY_READ_FAILED);
    expect(card.text).not.toContain(RECORDING_SUMMARY_PENDING);
  });

  test("held still renders the held sentence", () => {
    const card = readMarkup(markup({ kind: "held" }));

    expect(card.text).toContain(RECORDING_SUMMARY_HELD);
  });

  test("a partial summary keeps its headline and gains a caveat", () => {
    const card = readMarkup(markup(resolved(true)));

    expect(card.text).toContain(HEADLINE);
    for (const line of CONTEXT) expect(card.text).toContain(line);
    expect(card.text).toContain(PROVENANCE);
    expect(card.text).toContain(RECORDING_SUMMARY_PARTIAL);
    // The caveat is subordinate to the headline, not a replacement for it.
    expect(card.text.indexOf(HEADLINE)).toBeLessThan(card.text.indexOf(RECORDING_SUMMARY_PARTIAL));
  });

  test("a complete summary carries no caveat", () => {
    const card = readMarkup(markup(resolved(false)));

    expect(card.text).toContain(HEADLINE);
    expect(card.text).toContain(PROVENANCE);
    expect(card.text).not.toContain(RECORDING_SUMMARY_PARTIAL);
  });

  test("the six states render six different sentences", () => {
    const sentences = ALL_SIX.map((story) => readMarkup(markup(story)).text);

    expect(new Set(sentences).size).toBe(6);
  });

  test("no rendered state prints a refusal code or vendor text", () => {
    for (const story of ALL_SIX) {
      expect(readMarkup(markup(story)).text).not.toMatch(REFUSAL_OR_VENDOR);
    }
  });
});
