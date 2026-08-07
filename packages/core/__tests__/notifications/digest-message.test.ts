import { describe, expect, test } from "bun:test";

import {
  buildDigestMessage,
  digestLeadSentence,
  type DigestMessage,
} from "../../src/notifications/digest-message";
import { agentFirstContactSentence, keysRevokedSentence } from "../../src/notifications/sentence";

// D-8: the digest re-uses the per-type sentence builders rather than authoring a second
// copy of any sentence, and its lead line carries the denominator AGENTS.md requires —
// the count of the week it describes, not of the list it could fit.

function textOf(message: DigestMessage): string {
  return message.blocks.map((block) => ("text" in block ? block.text : "")).join("\n");
}

describe("the digest message is built from the shipped sentence builders and states its denominator", () => {
  test("every line is a shipped builder's sentence, verbatim, in a multi-section message", () => {
    const sentences = [
      keysRevokedSentence({ workspaceName: "Fixture workspace", revokedByName: "Priya" }),
      agentFirstContactSentence(),
    ];

    const message = buildDigestMessage({ sentences, totalCount: 2 });

    expect(message.blocks.length).toBeGreaterThan(1);
    for (const sentence of sentences) {
      // Verbatim, so no sentence is authored a second time inside the digest builder.
      expect(textOf(message)).toContain(sentence);
    }
    expect(message.fallbackText.trim().length).toBeGreaterThan(0);
  });

  test("the lead line reads 20 of 27 when the list is capped", () => {
    expect(digestLeadSentence(20, 27)).toContain("20 of 27");
  });

  test("the lead line reads 3 of 3 when nothing was capped", () => {
    expect(digestLeadSentence(3, 3)).toContain("3 of 3");
  });

  test("the built message carries the capped denominator, not the list length alone", () => {
    const sentences = Array.from(
      { length: 20 },
      (_, index) => `Something worth recording happened, number ${index + 1}.`,
    );

    const message = buildDigestMessage({ sentences, totalCount: 27 });

    expect(textOf(message)).toContain("20 of 27");
  });
});
