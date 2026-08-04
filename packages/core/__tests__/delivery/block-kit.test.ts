import { describe, expect, test } from "bun:test";

import { toBlockKit } from "../../src/delivery/block-kit";
import type { SlackBlock } from "../../src/delivery/slack-message";

const SECTION_TEXT = "ad-fake finding body";

// The shape Slack documents, taken verbatim from packages/adapters/__tests__/slack/fixtures.ts.
const DOCUMENTED_SECTION = {
  type: "section",
  text: { type: "mrkdwn", text: SECTION_TEXT },
};

describe("toBlockKit", () => {
  test("converts a rendered block into the shape Slack documents", () => {
    const blocks: readonly SlackBlock[] = [{ kind: "section", text: SECTION_TEXT }];

    const converted = toBlockKit(blocks);

    expect(converted).toEqual([DOCUMENTED_SECTION]);
    expect(JSON.stringify(converted)).toBe(JSON.stringify([DOCUMENTED_SECTION]));
  });
});
