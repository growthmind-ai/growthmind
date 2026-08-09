import { describe, expect, test } from "bun:test";

import { toBlockKit, toPostRequest } from "../../src/delivery/block-kit";
import type { SlackBlock } from "../../src/delivery/slack-message";

const SECTION_TEXT = "ad-fake finding body";

const CHANNEL_ID = "C0BLOCKKIT1";

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
        actions: [{ actionId: "a", label: PHISHING_LINK, value: "v", style: null }],
      },
    ]);

    const elements = (wire[0] as { elements: readonly { text: { type: string; text: string } }[] })
      .elements;

    expect(elements[0]?.text.type).toBe("plain_text");
    expect(elements[0]?.text.text).toBe(PHISHING_LINK);
  });
});

// `fallbackText` is mrkdwn too — it is the notification preview, the sidebar entry, the search
// result, and what a client ignoring blocks renders. A test asserting only on `blocks` proves
// nothing about the field Slack shows first.
describe("the request the poster is handed carries no raw mrkdwn in either frame", () => {
  test("a crafted link in the fallback text posts no clickable link", () => {
    const body = `CSV export ${PHISHING_LINK}`;

    const request = toPostRequest({
      channelId: CHANNEL_ID,
      blocks: [{ kind: "section", text: body }],
      fallbackText: body,
    });

    expect(request.fallbackText).not.toContain("<https://attacker.example");
    expect(request.fallbackText).toContain("&lt;https://attacker.example|Reset your password&gt;");
    expect(sectionTextOf(request.blocks[0])).toBe(request.fallbackText);
  });

  test("a channel broadcast in the fallback text posts no broadcast", () => {
    const request = toPostRequest({
      channelId: CHANNEL_ID,
      blocks: [{ kind: "context", text: `Heads up ${BROADCAST}` }],
      fallbackText: `Heads up ${BROADCAST}`,
    });

    expect(request.fallbackText).toBe("Heads up &lt;!channel&gt;");
  });

  test("the channel is carried through and ordinary text is left as written", () => {
    const request = toPostRequest({
      channelId: CHANNEL_ID,
      blocks: [{ kind: "section", text: SECTION_TEXT }],
      fallbackText: SECTION_TEXT,
    });

    expect(request.channelId).toBe(CHANNEL_ID);
    expect(request.fallbackText).toBe(SECTION_TEXT);
    expect(request.blocks).toEqual([DOCUMENTED_SECTION]);
  });
});
