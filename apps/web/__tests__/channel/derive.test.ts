import { describe, expect, test } from "bun:test";

import {
  POST_FAILURE_MESSAGES,
  RENDERED_MESSAGE_VERSION,
  RESIDUAL_PII_KINDS,
  RESIDUAL_PII_KIND_MESSAGES,
  deliveryFailureSentence,
} from "@growthmind/shared";

import {
  describeChannel,
  deriveDeliveryState,
  holdOf,
  readFailureCause,
  type DeliveryFacts,
} from "../../components/channel/derive";

const CLAIMED = new Date("2026-08-04T09:14:02.000Z");
const LEASE_EXPIRES_BEFORE = new Date("2026-08-04T08:44:02.000Z");

function facts(over: Partial<DeliveryFacts> = {}): DeliveryFacts {
  return {
    status: "posted",
    attempts: 1,
    claimedAt: CLAIMED,
    postedAt: new Date("2026-08-04T09:14:03.000Z"),
    failedAt: null,
    failureReason: null,
    renderedMessage: null,
    ...over,
  };
}

const RENDERED = {
  version: RENDERED_MESSAGE_VERSION,
  blocks: [{ kind: "section", text: "*/settings/team*" }],
  text: "/settings/team",
  legibility: { characters: 14, lines: 1 },
};

describe("a pending claim past its lease is takeable, not in flight", () => {
  test("a claim inside the lease reads as posting", () => {
    expect(deriveDeliveryState(facts({ status: "pending" }), LEASE_EXPIRES_BEFORE)).toBe("posting");
  });

  test("a claim older than the lease reads as stalled, never as posting now", () => {
    const abandoned = facts({
      status: "pending",
      claimedAt: new Date("2026-08-04T08:33:00.000Z"),
    });

    expect(deriveDeliveryState(abandoned, LEASE_EXPIRES_BEFORE)).toBe("stalled");
  });

  test("a claim at exactly the lease boundary is still in flight", () => {
    const onTheEdge = facts({ status: "pending", claimedAt: LEASE_EXPIRES_BEFORE });

    expect(deriveDeliveryState(onTheEdge, LEASE_EXPIRES_BEFORE)).toBe("posting");
  });
});

describe("a residual-PII hold and an outage share a column and not a lane", () => {
  for (const pii of RESIDUAL_PII_KINDS) {
    test(`a ${pii} hold reads as held back rather than failed`, () => {
      const sentence = RESIDUAL_PII_KIND_MESSAGES[pii];
      const held = facts({ status: "failed", failureReason: sentence });

      expect(deriveDeliveryState(held, LEASE_EXPIRES_BEFORE)).toBe("held_back");
      expect(readFailureCause(sentence)).toEqual({ kind: "residual_pii", pii });
    });
  }

  test("a Slack refusal reads as failed", () => {
    const failed = facts({
      status: "failed",
      failureReason: deliveryFailureSentence("rejected"),
    });

    expect(deriveDeliveryState(failed, LEASE_EXPIRES_BEFORE)).toBe("failed");
  });
});

describe("a failure reason is parsed to a code, never echoed", () => {
  for (const key of Object.keys(POST_FAILURE_MESSAGES)) {
    const code = key as keyof typeof POST_FAILURE_MESSAGES;

    test(`the stored sentence for ${code} resolves back to ${code}`, () => {
      expect(readFailureCause(POST_FAILURE_MESSAGES[code])).toEqual({
        kind: "post_failure",
        code,
      });
      expect(readFailureCause(deliveryFailureSentence(code))).toEqual({
        kind: "post_failure",
        code,
      });
    });
  }

  test("a vendor error body resolves to no code at all, so nothing of it can be printed", () => {
    const fromSlack = "not_in_channel (channel C0FIN9K2X, team T02ABCD, req sf-8812-aa)";

    expect(readFailureCause(fromSlack)).toEqual({ kind: "post_failure", code: null });
  });

  test("a missing reason resolves to no code rather than throwing", () => {
    expect(readFailureCause(null)).toEqual({ kind: "post_failure", code: null });
  });
});

describe("an absent render is stated, never filled in by re-rendering", () => {
  test("a posted row with no stored render predates the record", () => {
    expect(holdOf(facts())).toEqual({ kind: "predates_record" });
  });

  test("a row that never posted has no sent message to hold", () => {
    expect(holdOf(facts({ status: "failed", postedAt: null }))).toEqual({ kind: "never_sent" });
  });

  test("a shape we did not write is refused rather than coerced", () => {
    const wrong = holdOf(facts({ renderedMessage: { version: 99, blocks: [] } }));

    expect(wrong).toEqual({ kind: "predates_record" });
  });

  test("a render we do hold comes back whole", () => {
    const held = holdOf(facts({ renderedMessage: RENDERED }));

    expect(held.kind).toBe("held");
  });
});

describe("a channel is named or described, and never printed as its id", () => {
  const NOW = { channelId: "C0FIN9K2X", channelName: "issues" };

  test("the connection's own channel is named", () => {
    expect(describeChannel("C0FIN9K2X", NOW)).toBe("#issues");
  });

  test("a channel the delivery went to before the move is described, not named", () => {
    expect(describeChannel("C0OLDER11", NOW)).toBe("the channel connected at the time");
  });

  test("a connection with no readable name still never shows the id", () => {
    const unnamed = describeChannel("C0FIN9K2X", { channelId: "C0FIN9K2X", channelName: null });

    expect(unnamed).toBe("the connected channel");
    expect(unnamed).not.toContain("C0");
  });

  test("with no connection at all the delivery still describes where it went", () => {
    expect(describeChannel("C0FIN9K2X", null)).toBe("the channel connected at the time");
  });
});
