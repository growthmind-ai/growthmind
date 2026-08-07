import { describe, expect, test } from "bun:test";

import { inlineSpans } from "../../components/channel/inline";

describe("the stored blocks carry Slack's markup, so the page renders it rather than leaking it", () => {
  test("the heading's emphasis is reproduced, not printed as asterisks", () => {
    const spans = inlineSpans("*/settings/team*\nInvites fail silently.");

    expect(spans[0]).toEqual({ text: "/settings/team", strong: true });
    expect(spans.map((span) => span.text).join("")).not.toContain("*");
  });

  test("a citation link is reduced to its label, so no affordance of Slack's is drawn live", () => {
    const spans = inlineSpans("The workspace is missing (<https://app/rec/7|invite.tsx:41>).");
    const text = spans.map((span) => span.text).join("");

    expect(text).toBe("The workspace is missing (invite.tsx:41).");
    expect(text).not.toContain("https://");
  });

  test("plain text survives untouched", () => {
    expect(inlineSpans("14 of 110 sessions pressed Invite.")).toEqual([
      { text: "14 of 110 sessions pressed Invite.", strong: false },
    ]);
  });

  test("an unbalanced asterisk is left alone rather than swallowing the rest of the line", () => {
    const text = inlineSpans("a * b c")
      .map((span) => span.text)
      .join("");

    expect(text).toBe("a * b c");
  });

  test("an empty block does not produce an empty span list", () => {
    expect(inlineSpans("")).toEqual([{ text: "", strong: false }]);
  });
});
