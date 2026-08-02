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

  test("a channel_unavailable failure says a human must act and is not retryable", async () => {
    const outcome = await describeFailure("channel_unavailable");
    const notAuthorised = await describeFailure("not_authorised");

    expect(outcome.retryable).toBe(false);
    expect(outcome.marksStepDone).toBe(false);
    expect(outcome.sentence).toContain(POST_FAILURE_MESSAGES.channel_unavailable);

    expect(outcome.sentence).not.toBe(notAuthorised.sentence);

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
