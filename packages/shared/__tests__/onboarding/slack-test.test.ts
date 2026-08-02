import { describe, expect, test } from "bun:test";

import { POST_FAILURE_MESSAGES } from "../../src/delivery/messages";
import type { PostFailureCode, PostResult } from "../../src/delivery/poster";
import { isRetryablePostFailure, postFailureCodeSchema } from "../../src/delivery/poster";
import type { DescribeTestPostOutcome, TestPostOutcome } from "./contract-shapes";
import { loadUnderConstruction } from "./module-under-construction";

const loadDescribeTestPostOutcome = (): Promise<DescribeTestPostOutcome> =>
  loadUnderConstruction<DescribeTestPostOutcome>({
    modulePath: "../../src/onboarding/slack-test",
    exportName: "describeTestPostOutcome",
    ownedBy: "ADD Wave 1, the onboarding/slack-test.ts task",
  });

const CHANNEL = "C01AB2CD3EF";

const failure = (code: PostFailureCode): PostResult => ({
  ok: false,
  code,

  message: POST_FAILURE_MESSAGES[code],
});

const describeFailure = async (code: PostFailureCode): Promise<TestPostOutcome> => {
  const describeTestPostOutcome = await loadDescribeTestPostOutcome();
  return describeTestPostOutcome({ result: failure(code), channelId: CHANNEL });
};

describe("describeTestPostOutcome — FR-O11, UX Flow D", () => {
  test("a not_authorised failure says a human must reconnect and is not retryable", async () => {
    const outcome = await describeFailure("not_authorised");

    expect(outcome.retryable).toBe(false);
    expect(outcome.marksStepDone).toBe(false);

    expect(outcome.sentence).toContain(POST_FAILURE_MESSAGES.not_authorised);

    expect(outcome.sentence).toContain(
      "Someone has to reconnect Slack — trying again will not help.",
    );
  });

  // The clause this row pins was replaced. "Pick another channel — trying again will not help"
  // named an act the product does not serve: `attachChannel` fills an empty address and never
  // moves a chosen one. The bot has simply not been invited, so inviting it is the fix.
  test("a channel_unavailable failure names inviting the bot and sending again", async () => {
    const outcome = await describeFailure("channel_unavailable");
    const notAuthorised = await describeFailure("not_authorised");

    expect(outcome.marksStepDone).toBe(false);
    expect(outcome.sentence).toContain(POST_FAILURE_MESSAGES.channel_unavailable);

    // The working next action, both halves: the thing to do in Slack, and the press after it.
    expect(outcome.sentence).toContain(
      "The bot has to be invited to that channel before it can post there. Invite it in Slack, then send the test message again.",
    );

    // The old advice is gone from the WHOLE rendered paragraph, not merely the clause this
    // module owns — the shared table states what happened and stops, so no half can contradict
    // the other. The last row asserts that shared string, which this module may never edit.
    expect(outcome.sentence).not.toContain("pick another");
    expect(outcome.sentence).not.toContain("trying again will not help");
    expect(POST_FAILURE_MESSAGES.channel_unavailable).not.toContain("pick another");

    // Distinct from the row above in DIRECTION as well as wording: one withholds a press that
    // can never work, the other asks for it.
    expect(outcome.sentence).not.toBe(notAuthorised.sentence);

    // `retryable` answers "does pressing again, unchanged, fix it?" — no, a person invites the
    // bot first. It gates the SECOND button; the send button renders anyway, so `true` would
    // sit a "Try again" beside it firing the same post (D3).
    expect(outcome.retryable).toBe(false);
    expect(outcome.retryable).toBe(isRetryablePostFailure("channel_unavailable"));

    // UX Flow D: the rendered sentence is strictly more than what the delivery lane says.
    expect(outcome.sentence.length).toBeGreaterThan(
      POST_FAILURE_MESSAGES.channel_unavailable.length,
    );
  });

  test("a call_failed failure stays retryable and the step is not marked done", async () => {
    const outcome = await describeFailure("call_failed");

    expect(outcome.retryable).toBe(true);

    expect(outcome.marksStepDone).toBe(false);
    expect(outcome.sentence).toContain(POST_FAILURE_MESSAGES.call_failed);
  });

  test("a rejected failure renders its own sentence", async () => {
    const codes = postFailureCodeSchema.options;
    expect(codes).toHaveLength(4);

    const outcomes = await Promise.all(codes.map((code) => describeFailure(code)));
    const sentences = outcomes.map((outcome) => outcome.sentence);

    expect(new Set(sentences).size).toBe(sentences.length);

    for (const [index, code] of codes.entries()) {
      expect(outcomes[index]?.retryable).toBe(isRetryablePostFailure(code));
      expect(outcomes[index]?.marksStepDone).toBe(false);
    }
  });

  test("a successful post marks the step done and names the channel", async () => {
    const describeTestPostOutcome = await loadDescribeTestPostOutcome();

    const outcome = describeTestPostOutcome({
      result: { ok: true, messageRef: "1735689600.000100" },
      channelId: CHANNEL,
    });

    expect(outcome.marksStepDone).toBe(true);

    expect(outcome.retryable).toBe(false);

    expect(outcome.sentence).toContain(CHANNEL);
    expect(outcome.sentence).toContain("A test message just landed in");

    expect(outcome.sentence).toContain(
      "It names this workspace and who connected it, so your teammates find out from the channel.",
    );

    expect(outcome.sentence).not.toContain("1735689600.000100");
  });

  test("every sentence comes from POST_FAILURE_MESSAGES, none is authored here", async () => {
    const codes = postFailureCodeSchema.options;
    const outcomes = await Promise.all(codes.map((code) => describeFailure(code)));

    for (const [index, code] of codes.entries()) {
      expect(outcomes[index]?.sentence).toContain(POST_FAILURE_MESSAGES[code]);
    }

    expect("Slack rejected that. Try again later.").not.toContain(POST_FAILURE_MESSAGES.rejected);

    for (const outcome of outcomes) {
      expect(outcome.sentence).not.toMatch(
        /\binvalid_auth\b|\bchannel_not_found\b|\bnot_in_channel\b/i,
      );
      expect(outcome.sentence).not.toMatch(/\b[1-5]\d{2}\b/);
    }
  });
});
