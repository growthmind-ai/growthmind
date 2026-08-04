import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Badge, MantineProvider, Text } from "@mantine/core";

import type { BeatView, ClaimView } from "@growthmind/shared";

import { AnnotatedTranscript } from "../../components/findings/AnnotatedTranscript";

const BEATS: readonly BeatView[] = [
  {
    index: 0,
    at: "00:00",
    kind: "navigate",
    text: "landed /settings/team",
    notable: false,
    attempt: null,
  },
  {
    index: 1,
    at: "00:11",
    kind: "network",
    text: "POST /api/team/invite → 500",
    notable: true,
    attempt: null,
  },
  {
    index: 2,
    at: "00:19",
    kind: "click",
    text: 'clicked button "Send invite"',
    notable: false,
    attempt: 2,
  },
  {
    index: 3,
    at: "00:31",
    kind: "click",
    text: 'clicked button "Send invite"',
    notable: false,
    attempt: 3,
  },
];

const CLAIMS: readonly ClaimView[] = [
  { statement: "The request behind the button fails.", citesBeats: [1], citesLabel: "from 00:11" },
];

function markup(beats: readonly BeatView[] = BEATS): string {
  return renderToStaticMarkup(
    createElement(
      MantineProvider,
      null,
      createElement(AnnotatedTranscript, { beats, claims: CLAIMS, droppedClaims: 1 }),
    ),
  );
}

/** The contents of every `<p>` in the markup. `<p>` cannot nest, so this scan is exact. */
function paragraphs(html: string): string[] {
  const found: string[] = [];

  for (const match of html.matchAll(/<p\b[^>]*>/g)) {
    const start = (match.index ?? 0) + match[0].length;
    const end = html.indexOf("</p>", start);
    found.push(html.slice(start, end === -1 ? undefined : end));
  }

  return found;
}

/** The shape this file exists to keep out: a Badge (a div) inside a Text (a p). */
function brokenBeatLine(): string {
  return renderToStaticMarkup(
    <MantineProvider>
      <Text ff="monospace" size="xs">
        clicked button &quot;Send invite&quot;
        <Badge variant="default" size="xs">
          attempt 2
        </Badge>
      </Text>
    </MantineProvider>,
  );
}

describe("the annotated transcript renders valid markup", () => {
  test("CONTROL: the scan reads paragraphs, and would see a div inside one", () => {
    expect(paragraphs("<p class=x>one<div>two</div></p><p>three</p>")).toEqual([
      "one<div>two</div>",
      "three",
    ]);
  });

  test("CONTROL: the real Mantine pairing this replaced does render a div inside a p", () => {
    const offenders = paragraphs(brokenBeatLine()).filter((body) => /<div\b/.test(body));

    expect(offenders.length).toBe(1);
  });

  test("renders the attempt badges it is given", () => {
    const html = markup();

    expect(html).toContain("attempt 2");
    expect(html).toContain("attempt 3");
  });

  test("no paragraph contains a block element", () => {
    const offenders = paragraphs(markup()).filter((body) =>
      /<(div|p|ul|ol|section|form)\b/.test(body),
    );

    expect(offenders).toEqual([]);
  });

  test("a beat with no attempt still renders its text", () => {
    const html = markup([BEATS[0] as BeatView]);

    expect(html).toContain("landed /settings/team");
    expect(paragraphs(html).filter((body) => /<div\b/.test(body))).toEqual([]);
  });
});
