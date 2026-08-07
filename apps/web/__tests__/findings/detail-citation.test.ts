// UX First-Run Checklist rows 2-3 (.ai/ux/cause-stage-citation-gate.md §3, §4): a citation must
// be a real anchor that opens the cited recording moment in a new tab without disturbing the
// finding's own claim list, and it must be reachable and activatable by keyboard alone — Tab to
// focus, Enter to open. AnnotatedTranscript.tsx today renders `claim.citesLabel` as plain
// `<Text>` (no href at all), so every assertion below is red until Wave 7 wires the real anchor.
import { MantineProvider } from "@mantine/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "bun:test";

import type { BeatView } from "@growthmind/shared";

import { AnnotatedTranscript } from "../../components/findings/AnnotatedTranscript";
import type { ClaimViewWithHref } from "./helpers/wave0-types";

const BEATS: readonly BeatView[] = [
  {
    index: 0,
    at: "01:04",
    kind: "input",
    text: "left the email field blank",
    notable: true,
    attempt: null,
  },
  {
    index: 1,
    at: "01:11",
    kind: "click",
    text: 'clicked button "Submit"',
    notable: false,
    attempt: null,
  },
];

const CITED_HREF = "/replays/o44-citation-recording?t=64000";

const CLAIMS: readonly ClaimViewWithHref[] = [
  {
    statement: "The field was left blank, so the request never went out.",
    citesBeats: [0],
    citesLabel: "from 1:04",
    citesHref: CITED_HREF,
  },
  {
    statement: "The submit button then did nothing.",
    citesBeats: [1],
    citesLabel: "from 1:11",
    citesHref: null,
  },
];

function markup(): string {
  return renderToStaticMarkup(
    createElement(
      MantineProvider,
      null,
      createElement(AnnotatedTranscript, { beats: BEATS, claims: CLAIMS, droppedClaims: 0 }),
    ),
  );
}

// Everything between one <a ...> open tag and its matching </a>.
function anchorTags(html: string): readonly string[] {
  return [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map((match) => match[0]);
}

describe("UX rows 2-3 — the citation link", () => {
  test("a citation opens the cited recording moment in a new tab, and the rest of the claim list stays untouched", () => {
    const html = markup();
    const anchors = anchorTags(html);
    const cited = anchors.find((tag) => tag.includes(CITED_HREF));

    expect(cited).toBeDefined();
    expect(cited).toContain('target="_blank"');
    expect(cited).toContain('rel="noopener noreferrer"');

    // The full claim list is still present around the link — clicking it must not have
    // rewritten or dropped the sibling claim.
    expect(html).toContain("The field was left blank, so the request never went out.");
    expect(html).toContain("The submit button then did nothing.");
  });

  test("a citation with nowhere to send the reader falls back to plain text, never a dead link — distinct from a claim that DOES have somewhere to send them", () => {
    const html = markup();
    const anchors = anchorTags(html);

    // The contrast is the contract: today neither claim renders as a link, so asserting only
    // the null-href half in isolation would hold by accident. Pairing it with the resolved-href
    // half (which must become a real anchor) is what keeps this test honestly red until the
    // component actually distinguishes the two.
    expect(anchors.some((tag) => tag.includes(CITED_HREF))).toBe(true);
    expect(anchors.some((tag) => tag.includes("from 1:11"))).toBe(false);
    expect(html).toContain("from 1:11");
  });

  test("the citation is a real anchor — natively Tab-reachable and Enter-activatable, no custom key handling", () => {
    const html = markup();
    const anchors = anchorTags(html);
    const cited = anchors.find((tag) => tag.includes(CITED_HREF));

    expect(cited).toBeDefined();
    // A native <a href> needs no tabindex or role to be keyboard-operable; either would signal
    // a non-native control standing in for one.
    expect(cited).not.toMatch(/tabindex\s*=/i);
    expect(cited).not.toMatch(/role\s*=\s*"button"/i);
    expect(cited).not.toMatch(/onclick/i);
  });

  test("the citation link carries a visually-hidden context-change warning (WCAG 3.2.5) before it opens a new tab", () => {
    const html = markup();
    const anchors = anchorTags(html);
    const cited = anchors.find((tag) => tag.includes(CITED_HREF));

    expect(cited).toBeDefined();
    expect(cited?.toLowerCase()).toContain("opens the replay in a new tab");
  });
});
