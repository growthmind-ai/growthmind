import { describe, expect, test } from "bun:test";

import { escapeMrkdwn, toBlockKit } from "../../src/delivery/block-kit";
import type { SlackBlock } from "../../src/delivery/slack-message";

const SECTION_TEXT = "ad-fake finding body";

// The shape Slack documents, taken verbatim from packages/adapters/__tests__/slack/fixtures.ts.
const DOCUMENTED_SECTION = {
  type: "section",
  text: { type: "mrkdwn", text: SECTION_TEXT },
};

// 512 characters of caller free text reach a section through report_shipped's description and
// page, so these are the two constructs an injected coding agent would reach for.
const PHISHING_LINK = "<https://attacker.example|Reset your password>";
const BROADCAST = "<!channel>";

function sectionTextOf(block: unknown): string {
  return (block as { text: { text: string } }).text.text;
}

function contextTextOf(block: unknown): string {
  return (block as { elements: readonly { text: string }[] }).elements[0]?.text ?? "";
}

describe("toBlockKit", () => {
  test("converts a rendered block into the shape Slack documents", () => {
    const blocks: readonly SlackBlock[] = [{ kind: "section", text: SECTION_TEXT }];

    const converted = toBlockKit(blocks);

    expect(converted).toEqual([DOCUMENTED_SECTION]);
    expect(JSON.stringify(converted)).toBe(JSON.stringify([DOCUMENTED_SECTION]));
  });
});

describe("caller free text cannot speak mrkdwn in Growthmind's voice", () => {
  test("a section carrying a crafted link posts no clickable link", () => {
    const wire = toBlockKit([{ kind: "section", text: `CSV export ${PHISHING_LINK}` }]);

    const text = sectionTextOf(wire[0]);

    expect(text).not.toContain("<https://attacker.example");
    expect(text).toContain("&lt;https://attacker.example|Reset your password&gt;");
  });

  test("a context carrying a channel broadcast posts no broadcast", () => {
    const wire = toBlockKit([{ kind: "context", text: `Heads up ${BROADCAST}` }]);

    expect(contextTextOf(wire[0])).toBe("Heads up &lt;!channel&gt;");
  });

  test("a button label is plain_text and is left exactly as written", () => {
    const wire = toBlockKit([
      {
        kind: "actions",
        blockId: "block-1",
        actions: [
          { actionId: "a", label: PHISHING_LINK, value: "v", style: null },
        ],
      },
    ]);

    const elements = (wire[0] as { elements: readonly { text: { type: string; text: string } }[] })
      .elements;

    expect(elements[0]?.text.type).toBe("plain_text");
    expect(elements[0]?.text.text).toBe(PHISHING_LINK);
  });
});

describe("escapeMrkdwn", () => {
  test("an ampersand in an ordinary sentence still reads as an ampersand", () => {
    expect(escapeMrkdwn("Search & filter on /reports")).toBe("Search &amp; filter on /reports");
  });

  test("escapes each character once, so an escape is never escaped again", () => {
    expect(escapeMrkdwn("&lt;")).toBe("&amp;lt;");
    expect(escapeMrkdwn("<a & b>")).toBe("&lt;a &amp; b&gt;");
  });

  test("leaves text with none of the three untouched", () => {
    expect(escapeMrkdwn(SECTION_TEXT)).toBe(SECTION_TEXT);
  });
});
