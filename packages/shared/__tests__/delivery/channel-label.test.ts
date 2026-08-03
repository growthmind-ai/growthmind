// B-037: `slack_connections` stored only `channel_id`, so every delivery sentence
// rendered `#C01AB2CD3EF` — on exactly the sentences a founder has to act on, and
// with no way to tell whether that was the channel they picked.
import { describe, expect, test } from "bun:test";

import { channelLabel } from "../../src/delivery/channel-label";
import { renderDeliveryClosure, renderDeliveryLine } from "../../src/onboarding/stage-view";
import { describeTestPostOutcome } from "../../src/onboarding/slack-test";

const ID = "C01AB2CD3EF";

describe("what a founder is shown where a channel is named (B-037)", () => {
  test("the stored name wins over the id", () => {
    expect(channelLabel({ channelId: ID, channelName: "growth" })).toBe("growth");
  });

  test("no name falls back to the id, which is the half that gets forgotten", () => {
    for (const name of [null, "", "   "]) {
      expect(`${JSON.stringify(name)}:${channelLabel({ channelId: ID, channelName: name })}`).toBe(
        `${JSON.stringify(name)}:${ID}`,
      );
    }
  });

  test("a name stored with its hash renders one hash, not two", () => {
    // The templates supply the `#`. Slack's own listing does not include it, but a
    // pasted or migrated value can.
    expect(channelLabel({ channelId: ID, channelName: "#growth" })).toBe("growth");
    expect(channelLabel({ channelId: ID, channelName: "  ##growth  " })).toBe("growth");
  });

  test("neither a name nor an address is null, never an empty label", () => {
    expect(channelLabel({ channelId: null, channelName: null })).toBeNull();
    expect(channelLabel({ channelId: "   ", channelName: "  " })).toBeNull();
  });

  test("the delivery sentences name the channel, not the id", () => {
    const named = renderDeliveryLine("posted", ID, "growth");

    expect(named).toContain("#growth");
    expect(named).not.toContain(ID);
  });

  test("a row with no name still names the id rather than rendering a hole", () => {
    for (const label of [null, "", "   "]) {
      expect(renderDeliveryLine("posted", ID, label)).toContain(`#${ID}`);
    }
  });

  test("the address still decides whether there is anything to claim", () => {
    // A label cannot conjure a delivery: the gate is the address, and a sentinel
    // address closes with nowhere-to-deliver however good the name is.
    for (const address of [null, "", "null", "undefined"]) {
      expect(renderDeliveryLine("posted", address, "growth")).toBeNull();
    }

    expect(renderDeliveryClosure("posted", "null", "growth")).not.toContain("growth");
  });

  test("the test-post sentence names the channel the founder picked", () => {
    const outcome = describeTestPostOutcome({
      result: { ok: true, messageRef: "1735689600.000100" },
      channelId: ID,
      channelLabel: "growth",
    });

    expect(outcome.sentence).toContain("#growth");
    expect(outcome.sentence).not.toContain(ID);
  });
});
