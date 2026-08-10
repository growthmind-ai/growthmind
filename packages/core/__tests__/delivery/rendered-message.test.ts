import { describe, expect, test } from "bun:test";

import { DELIVERY_VOCABULARY, parseRenderedMessage } from "@growthmind/shared";

import { measuredCount } from "../../src/counts/measured-count";
import { toBlockKit } from "../../src/delivery/block-kit";
import { escapeMrkdwn } from "../../src/delivery/mrkdwn";
import { renderSlackMessage, renderedMessageOf } from "../../src/delivery/slack-message";
import type { SlackMessageInput } from "../../src/delivery/slack-message";

const WINDOW = {
  start: new Date("2026-07-20T00:00:00.000Z"),
  end: new Date("2026-07-27T00:00:00.000Z"),
};

function input(overrides: { cause?: boolean; surfacePath?: string } = {}): SlackMessageInput {
  return {
    decision: "deliver",
    surfacePath: overrides.surfacePath ?? "/checkout/payment",
    observations: [
      {
        label: "left before finishing",
        count: measuredCount({
          numerator: 3,
          denominator: 28,
          unit: "sessions",
          timeframe: WINDOW,
          basis: { totalInWindow: 28, kept: 28, keptUnchecked: 0, setAside: [] },
        }),
      },
    ],
    explanation: {
      source: "model_rendered",
      headline: "The payment step is losing sessions",
      context: "Sessions reached the payment step and left without finishing.",
      ...(overrides.cause === true
        ? {
            cause: {
              grade: "explained" as const,
              claims: [
                {
                  statement: "The card form asks for a billing address before naming a price",
                  citesHref: null,
                  citesLabel: "checkout.tsx:41",
                },
              ],
              droppedClaims: 0,
            },
          }
        : {}),
    },
    findingId: "finding-1",
  };
}

describe("the record keeps what was sent, not what would be rendered now", () => {
  test("both frames come from one render, so the stored text is the text Slack was given", () => {
    const message = renderSlackMessage(input(), DELIVERY_VOCABULARY);

    const stored = renderedMessageOf(message);
    const wire = toBlockKit(message.blocks);

    expect(stored.text).toBe(message.text);
    expect(stored.blocks).toHaveLength(wire.length);
    expect(stored.legibility).toEqual(message.legibility);
  });

  test("the record holds the sentence a person read, and the wire holds that sentence escaped", () => {
    // The two differ by Slack's transport encoding and by nothing else. Storing the escaped form
    // would put `&amp;` in front of a reader of the transcript, so the record keeps the sentence
    // and this asserts the escape is the only distance between them.
    const message = renderSlackMessage(
      input({ surfacePath: "/reports?plan=pro&ref=slack" }),
      DELIVERY_VOCABULARY,
    );

    const stored = renderedMessageOf(message);
    const wire = toBlockKit(message.blocks);

    const heading = stored.blocks[0];
    const posted = (wire[0] as { text: { text: string } }).text.text;

    expect(heading?.kind).toBe("section");
    expect(heading?.kind === "section" && heading.text).toContain("&ref=slack");
    expect(posted).toContain("&amp;ref=slack");
    expect(posted).toBe(escapeMrkdwn(heading?.kind === "section" ? heading.text : ""));
  });

  test("a stored render survives a round trip through the column's own reader", () => {
    const stored = renderedMessageOf(renderSlackMessage(input(), DELIVERY_VOCABULARY));

    expect(parseRenderedMessage(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  });

  test("a cause added to a finding after delivery cannot change what the record already holds", () => {
    // The hazard the column exists for: `cause` is additive, so the same finding re-rendered
    // later gains a clause Slack never carried. The stored render is the proof, not the input.
    const asDelivered = renderedMessageOf(renderSlackMessage(input(), DELIVERY_VOCABULARY));
    const asReRendered = renderedMessageOf(
      renderSlackMessage(input({ cause: true }), DELIVERY_VOCABULARY),
    );

    expect(asReRendered.text).not.toBe(asDelivered.text);
    expect(asDelivered.text).not.toContain("checkout.tsx:41");
  });
});
