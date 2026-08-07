import { describe, expect, test } from "bun:test";

import {
  DELIVERY_LANE_FAILURE_CLAUSE,
  DELIVERY_STATUS_MESSAGES,
  RENDERED_MESSAGE_VERSION,
  RESIDUAL_PII_KIND_MESSAGES,
  deliveryFailureSentence,
  type PostFailureCode,
} from "@growthmind/shared";

import {
  countRecord,
  healthSentence,
  toCard,
  type CardContext,
  type DeliveryInput,
} from "../../components/channel/view";

const NOW = new Date("2026-08-04T10:00:00.000Z");

const CTX: CardContext = {
  connection: { channelId: "C0FIN9K2X", channelName: "issues" },
  staleClaimsBefore: new Date("2026-08-04T09:30:00.000Z"),
  nowMs: NOW.getTime(),
};

const RENDERED = {
  version: RENDERED_MESSAGE_VERSION,
  blocks: [
    { kind: "section", text: "*/settings/team*\nInvites fail silently on team settings." },
    {
      kind: "section",
      text: "14 of 110 sessions pressed Invite and the request behind it failed.",
    },
    { kind: "context", text: "Counted 110 of the 126 sessions we looked at." },
    {
      kind: "actions",
      blockId: "finding:8c21",
      actions: [
        { actionId: "get_it_fixed", label: "Get it fixed", value: "8c21", style: "primary" },
        { actionId: "not_useful", label: "Not useful", value: "8c21", style: null },
      ],
    },
  ],
  text: "/settings/team",
  legibility: { characters: 200, lines: 5 },
};

function delivery(over: Partial<DeliveryInput> = {}): DeliveryInput {
  return {
    id: "d_8c21",
    findingId: "8c21",
    channelId: "C0FIN9K2X",
    status: "posted",
    attempts: 1,
    claimedAt: new Date("2026-08-04T09:44:02.000Z"),
    postedAt: new Date("2026-08-04T09:44:03.000Z"),
    failedAt: null,
    failureReason: null,
    renderedMessage: RENDERED,
    dismissedAs: null,
    dismissedAt: null,
    ...over,
  };
}

describe("a failure is the only news, so it arrives open and says what happened in our words", () => {
  test("a failed delivery opens itself and a posted one does not", () => {
    const failed = toCard(
      delivery({
        status: "failed",
        postedAt: null,
        attempts: 3,
        failedAt: NOW,
        failureReason: deliveryFailureSentence("rejected"),
      }),
      CTX,
    );

    expect(failed.openOnPaint).toBe(true);
    expect(toCard(delivery(), CTX).openOnPaint).toBe(false);
  });

  test("the sentence comes from the parsed code, and a vendor body reaches nothing on screen", () => {
    const leaked = "not_in_channel (channel C0FIN9K2X, team T02ABCD, req sf-8812-aa)";
    const card = toCard(
      delivery({ status: "failed", postedAt: null, failedAt: NOW, failureReason: leaked }),
      CTX,
    );

    expect(card.why).toBe(DELIVERY_STATUS_MESSAGES.failed ?? "");

    const everythingRendered = [card.why, card.strip, ...card.receipt.map((row) => row.text)].join(
      " ",
    );
    expect(everythingRendered).not.toContain("not_in_channel");
    expect(everythingRendered).not.toContain("T02ABCD");
  });

  test("only the two codes a human can act on carry a repair", () => {
    const repairFor = (code: PostFailureCode) =>
      toCard(
        delivery({
          status: "failed",
          postedAt: null,
          failedAt: NOW,
          failureReason: deliveryFailureSentence(code),
        }),
        CTX,
      ).repair;

    expect(repairFor("not_authorised")?.kind).toBe("link");
    expect(repairFor("channel_unavailable")).toEqual({
      kind: "note",
      text: DELIVERY_LANE_FAILURE_CLAUSE.channel_unavailable ?? "",
    });
    expect(repairFor("rejected")).toBeNull();
    expect(repairFor("call_failed")).toBeNull();
  });
});

describe("a hold is a decision, not an outage", () => {
  test("residual PII is amber and worded as a choice, on the same status column", () => {
    const held = toCard(
      delivery({
        status: "failed",
        postedAt: null,
        failedAt: NOW,
        failureReason: RESIDUAL_PII_KIND_MESSAGES.email_address,
      }),
      CTX,
    );

    expect(held.state).toBe("held_back");
    expect(held.tone).toBe("held");
    expect(held.strip).toBe("We held this back — not a failure");
    expect(held.why).toBe(RESIDUAL_PII_KIND_MESSAGES.email_address);
    expect(held.repair).toBeNull();
  });
});

describe("a retry keeps its count and refuses to name causes it no longer holds", () => {
  test("the strip names the attempt and the receipt says why we will not guess", () => {
    const card = toCard(delivery({ attempts: 3 }), CTX);

    expect(card.state).toBe("posted_retried");
    expect(card.strip).toBe("Posted to #issues on the 3rd try");
    expect(card.why).toContain("We do not keep why");
  });
});

describe("what we do not hold is stated, and everything that lived in it goes with it", () => {
  test("a posted row with no render says the copy is gone rather than rebuilding it", () => {
    const card = toCard(delivery({ renderedMessage: null }), CTX);

    expect(card.body.kind).toBe("absent");
    expect(card.body.kind === "absent" && card.body.note).toContain("did not keep a copy");
    // The receipt never lived in the render, so it is unaffected.
    expect(card.strip).toContain("Posted to #issues");
  });

  test("a row that never posted says nothing was sent, not that the copy is missing", () => {
    const card = toCard(
      delivery({
        status: "failed",
        postedAt: null,
        renderedMessage: null,
        failedAt: NOW,
        failureReason: deliveryFailureSentence("rejected"),
      }),
      CTX,
    );

    expect(card.body.kind === "absent" && card.body.note).toContain("Nothing was sent");
  });

  test("the Slack-buttons line is read off the render, so it disappears with it", () => {
    const held = toCard(delivery(), CTX);
    expect(held.body.kind === "held" && held.body.actionLabels).toEqual([
      "Get it fixed",
      "Not useful",
    ]);

    const gone = toCard(delivery({ renderedMessage: null }), CTX);
    expect(gone.body.kind).toBe("absent");
  });
});

describe("a dismissal is readable here and not actionable here", () => {
  test("the card dims, stays in place, and gains one receipt line", () => {
    const card = toCard(
      delivery({ dismissedAs: "not_useful", dismissedAt: new Date("2026-08-04T09:50:00.000Z") }),
      CTX,
    );

    expect(card.dimmed).toBe(true);
    expect(card.strip).toBe("Posted, then dismissed in Slack");
    expect(card.receipt.at(-1)?.text).toContain("Not useful pressed in Slack");
    expect(card.repair).toBeNull();
  });
});

describe("every number carries its denominator, and only one of the four is bad news", () => {
  const cards = [
    toCard(delivery({ id: "a" }), CTX),
    toCard(delivery({ id: "b" }), CTX),
    toCard(
      delivery({
        id: "c",
        status: "failed",
        postedAt: null,
        failedAt: NOW,
        failureReason: deliveryFailureSentence("rejected"),
      }),
      CTX,
    ),
    toCard(
      delivery({
        id: "d",
        status: "pending",
        postedAt: null,
        claimedAt: new Date("2026-08-04T09:59:00.000Z"),
      }),
      CTX,
    ),
    toCard(
      delivery({
        id: "e",
        status: "pending",
        postedAt: null,
        claimedAt: new Date("2026-08-04T09:00:00.000Z"),
      }),
      CTX,
    ),
  ];

  test("a message mid-flight is not counted as a shortfall, and a stalled one is not counted as on the way", () => {
    const counts = countRecord(cards);

    expect(counts).toEqual({ total: 5, arrived: 2, failed: 1, held: 0, inFlight: 1, stalled: 1 });
  });

  test("the headline states what arrived out of how many, and names where", () => {
    const sentence = healthSentence(countRecord(cards), {
      kind: "delivering",
      channel: "#issues",
    });

    expect(sentence?.arrived).toBe("2 of 5");
    expect(sentence?.where).toBe("#issues");
    expect(sentence?.extras.join(" ")).toContain("One did not");
    expect(sentence?.extras.join(" ")).toContain("stalled part-way");
  });

  test("an empty record has no counting sentence to make", () => {
    expect(healthSentence(countRecord([]), { kind: "never_connected" })).toBeNull();
  });
});
