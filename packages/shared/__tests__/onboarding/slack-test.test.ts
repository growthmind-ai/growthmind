// THE SLACK TEST POST — FR-O11, UX Flow D. ADD §9, 6 rows.
//
// ###########################################################################
// # THE ONE DISTINCTION THIS FUNCTION EXISTS TO MAKE.
// #
// # A founder staring at a failed test message needs exactly one thing: can
// # they press the button again, or does a human have to go and fix
// # something? `postFailureCodeSchema` paid for four codes precisely so that
// # question has an answer, and a surface that renders all four the same way
// # throws that away and leaves the founder pressing a button that cannot
// # ever work.
// #
// # So `retryable` is DERIVED from `isRetryablePostFailure`, never carried as
// # a second hand-set boolean — the shipped comment on that function says why:
// # "a boolean the adapter sets by hand is a boolean that eventually
// # contradicts its own code" (packages/shared/src/delivery/poster.ts:42-49).
// #
// # AND `marksStepDone` IS FALSE ON EVERY FAILURE. UX Flow D: "IN ALL FOUR
// # CASES: setup is not broken." The step is not done, and it is also not an
// # error state that blocks the sequence — "Skip for now" is still there and
// # still reaches step 5. That is D8: a failing side effect never fails the
// # main flow.
// ###########################################################################
//
// B3 / FR-O22 — ONE HOME. Every sentence here is BUILT ON the shipped
// `POST_FAILURE_MESSAGES`, which already carries the plain-English audit, the
// "nothing about what we found has changed" rule and four genuinely different
// next steps. This module adds the ONBOARDING-SPECIFIC clause the UX spec
// makes normative on top of it; it does not re-author the sentence. A second
// vocabulary for the same four codes drifts within a week, and then two
// screens tell a customer two different things about one Slack failure.

import { describe, expect, test } from "bun:test";

import { POST_FAILURE_MESSAGES } from "../../src/delivery/messages";
import type { PostFailureCode, PostResult } from "../../src/delivery/poster";
import { isRetryablePostFailure, postFailureCodeSchema } from "../../src/delivery/poster";
import type { DescribeTestPostOutcome, TestPostOutcome } from "./contract-shapes";
import { loadUnderConstruction } from "./module-under-construction";

/** ADD Wave 1 creates `packages/shared/src/onboarding/slack-test.ts`. */
const loadDescribeTestPostOutcome = (): Promise<DescribeTestPostOutcome> =>
  loadUnderConstruction<DescribeTestPostOutcome>({
    modulePath: "../../src/onboarding/slack-test",
    exportName: "describeTestPostOutcome",
    ownedBy: "ADD Wave 1, the onboarding/slack-test.ts task",
  });

/** FR-O13: read from the `slack_connections` row, never accepted from a
 *  payload. The value is opaque to this module — it renders what it is
 *  handed. */
const CHANNEL = "C01AB2CD3EF";

const failure = (code: PostFailureCode): PostResult => ({
  ok: false,
  code,
  // The ADAPTER's message. Deliberately NOT the one that reaches the screen:
  // `packages/adapters/src/slack/errors.ts:182` already maps a Slack error to
  // `POST_FAILURE_MESSAGES[code]`, and the inherited obligation on
  // `postResultSchema` is that the vendor's own text never reaches a customer.
  message: POST_FAILURE_MESSAGES[code],
});

const describeFailure = async (code: PostFailureCode): Promise<TestPostOutcome> => {
  const describeTestPostOutcome = await loadDescribeTestPostOutcome();
  return describeTestPostOutcome({ result: failure(code), channelId: CHANNEL });
};

describe("describeTestPostOutcome — FR-O11, UX Flow D", () => {
  // ---------------------------------------------------------------- §9 row 1
  test("a not_authorised failure says a human must reconnect and is not retryable", async () => {
    const outcome = await describeFailure("not_authorised");

    expect(outcome.retryable).toBe(false);
    expect(outcome.marksStepDone).toBe(false);

    // The shipped sentence, verbatim and entire (B3).
    expect(outcome.sentence).toContain(POST_FAILURE_MESSAGES.not_authorised);

    // Plus the onboarding clause UX row 13 makes normative. The shipped
    // sentence says someone will need to reconnect; THIS clause says the thing
    // the founder cannot work out on their own — that pressing the button
    // again is not one of their options. Without it, a primary "Try again" is
    // the obvious thing to build, and it can never succeed.
    expect(outcome.sentence).toContain(
      "Someone has to reconnect Slack — trying again will not help.",
    );
  });

  // ---------------------------------------------------------------- §9 row 2
  //
  // ###########################################################################
  // # THE CLAUSE THIS ROW PINS WAS REPLACED, AND THE REASON IS THE POINT.
  // #
  // # It used to be "Someone has to pick another channel — trying again will
  // # not help.", and this row asserted it. That was correct while a channel
  // # could be re-picked. `attachChannel` fills an empty address and never
  // # moves a chosen one — the delivery ledger's identity carries the channel,
  // # so re-pointing forks every delivery an installation has ever recorded
  // # (`packages/db/src/repositories/slack-connections.repo.ts`) — and this
  // # code is only reachable AFTER the address is stamped.
  // #
  // # So the sentence named an act the product does not serve, and "trying
  // # again will not help" was the exact inverse of the truth: the bot has not
  // # been invited to the chosen channel, and inviting it and pressing send is
  // # what fixes it. The send button is already on the card in this state.
  // #
  // # A test asserting the old sentence would now be pinning the lie in place,
  // # which is why it is replaced here rather than left to fail.
  // ###########################################################################
  test("a channel_unavailable failure names inviting the bot and sending again", async () => {
    const outcome = await describeFailure("channel_unavailable");
    const notAuthorised = await describeFailure("not_authorised");

    expect(outcome.marksStepDone).toBe(false);
    expect(outcome.sentence).toContain(POST_FAILURE_MESSAGES.channel_unavailable);

    // THE WORKING NEXT ACTION, NAMED. Both halves: the thing to do over in
    // Slack, and the press that follows it here.
    expect(outcome.sentence).toContain(
      "The bot has to be invited to that channel before it can post there. Invite it in Slack, then send the test message again.",
    );

    // AND THE OLD ADVICE IS GONE FROM THE WHOLE PARAGRAPH, not merely from the
    // clause this module owns.
    //
    // ###########################################################################
    // # THE SCOPE OF THIS ASSERTION IS THE POINT, AND IT WIDENED FOR A REASON.
    // #
    // # It used to scan only the clause — sliced off the end — because the
    // # shipped `POST_FAILURE_MESSAGES.channel_unavailable` still ended
    // # "Someone will need to pick another one." B3 forbids this module from
    // # re-wording the shipped sentence, so the contradiction was FLAGGED here
    // # and left in place: the founder read "pick another one" and then "invite
    // # the bot and send again", two next actions in one paragraph, pointing
    // # opposite ways.
    // #
    // # The delivery lane made its own decision, which is what that flag was
    // # waiting for: the shared table now states WHAT HAPPENED and stops, and
    // # each surface composes the next action its own screen can serve. So the
    // # scan is over the whole rendered sentence, which is what a founder
    // # actually reads, and there is no half of it left that may contradict the
    // # other.
    // ###########################################################################
    expect(outcome.sentence).not.toContain("pick another");
    expect(outcome.sentence).not.toContain("trying again will not help");

    // AND THE FACT HALF NAMES NO ACT AT ALL. Asserted against the shared table
    // directly, because that is the string this module has no right to edit and
    // every right to depend on.
    expect(POST_FAILURE_MESSAGES.channel_unavailable).not.toContain("pick another");

    // DISTINCT FROM THE ROW ABOVE, and now distinct in DIRECTION as well as in
    // wording: one withholds a press that can never work, the other asks for
    // it. A founder told the wrong one goes and does work that changes nothing.
    expect(outcome.sentence).not.toBe(notAuthorised.sentence);

    // RETRYABLE STAYS FALSE, AND IT DOES NOT CONTRADICT THE COPY. The flag
    // answers "does pressing again, unchanged, fix it?" — no, a person has to
    // invite the bot first. What it gates is the SECOND button; the send button
    // renders in every unsettled state and, on a stamped address, does nothing
    // but re-post, so a `true` here would sit a "Try again" beside it firing
    // the same post (D3). The derivation is the shipped one either way.
    expect(outcome.retryable).toBe(false);
    expect(outcome.retryable).toBe(isRetryablePostFailure("channel_unavailable"));

    // UX Flow D requires the same shape as row 13 — the shipped sentence PLUS
    // the onboarding clause — so the rendered sentence is strictly more than
    // what the delivery lane already says.
    expect(outcome.sentence.length).toBeGreaterThan(
      POST_FAILURE_MESSAGES.channel_unavailable.length,
    );
  });

  // ---------------------------------------------------------------- §9 row 3
  test("a call_failed failure stays retryable and the step is not marked done", async () => {
    const outcome = await describeFailure("call_failed");

    // UX row 14: a "Try again" that STAYS AVAILABLE. This is the one code of
    // the four where pressing the button again is the right advice.
    expect(outcome.retryable).toBe(true);

    // And still not done. A transient failure has proved nothing about the
    // connection, so claiming the step succeeded would be a fake confirmation
    // — the exact failure mode the whole "no step is done without proof"
    // discipline exists to stop.
    expect(outcome.marksStepDone).toBe(false);
    expect(outcome.sentence).toContain(POST_FAILURE_MESSAGES.call_failed);
  });

  // ---------------------------------------------------------------- §9 row 4
  test("a rejected failure renders its own sentence", async () => {
    // ALL FOUR CODES RENDER DISTINCTLY. Asserted over the whole enum rather
    // than as a fourth spot check, so a code added to `postFailureCodeSchema`
    // later cannot quietly fall through to a shared default.
    const codes = postFailureCodeSchema.options;
    expect(codes).toHaveLength(4);

    const outcomes = await Promise.all(codes.map((code) => describeFailure(code)));
    const sentences = outcomes.map((outcome) => outcome.sentence);

    expect(new Set(sentences).size).toBe(sentences.length);

    // `rejected` is the quietest of the four and the easiest to fold into
    // `call_failed` by accident: both are "it did not arrive". They are
    // different answers — one is worth retrying and one is not — and
    // `retryable` must follow the SHIPPED derivation, never a local opinion.
    for (const [index, code] of codes.entries()) {
      expect(outcomes[index]?.retryable).toBe(isRetryablePostFailure(code));
      expect(outcomes[index]?.marksStepDone).toBe(false);
    }
  });

  // ---------------------------------------------------------------- §9 row 5
  test("a successful post marks the step done and names the channel", async () => {
    const describeTestPostOutcome = await loadDescribeTestPostOutcome();

    const outcome = describeTestPostOutcome({
      result: { ok: true, messageRef: "1735689600.000100" },
      channelId: CHANNEL,
    });

    expect(outcome.marksStepDone).toBe(true);
    // Nothing to retry — it worked. A retry offered beside a success is a
    // control with no meaning.
    expect(outcome.retryable).toBe(false);

    // IT NAMES THE CHANNEL. "A test message was sent" is not a confirmation —
    // the founder has to go and look somewhere, and we know where. UX row 15's
    // normative copy.
    expect(outcome.sentence).toContain(CHANNEL);
    expect(outcome.sentence).toContain("A test message just landed in");

    // And it says what the message itself contains, which is the answer to
    // OQ-O6: the test message IS the announcement to the rest of the org, so a
    // teammate learns from the channel rather than from a notification system
    // this sprint does not build (EC-O1, AD-24).
    expect(outcome.sentence).toContain(
      "It names this workspace and who connected it, so your teammates find out from the channel.",
    );

    // The Slack message handle is an internal id and never reaches the screen
    // (D9: a raw internal id leaking into a rendered string).
    expect(outcome.sentence).not.toContain("1735689600.000100");
  });

  // ---------------------------------------------------------------- §9 row 6
  test("every sentence comes from POST_FAILURE_MESSAGES, none is authored here", async () => {
    const codes = postFailureCodeSchema.options;
    const outcomes = await Promise.all(codes.map((code) => describeFailure(code)));

    // B3. Each failure sentence CARRIES the shipped one verbatim and entire —
    // the onboarding module may add the "who has to do what" clause on top, it
    // may not paraphrase, shorten or re-word what the delivery lane already
    // says. Two screens describing one Slack failure two different ways is the
    // drift `ALL_DELIVERY_MESSAGES` exists to prevent.
    for (const [index, code] of codes.entries()) {
      expect(outcomes[index]?.sentence).toContain(POST_FAILURE_MESSAGES[code]);
    }

    // POSITIVE CONTROL: prove the containment check is load-bearing rather
    // than trivially satisfiable. A re-authored sentence about the same code
    // does NOT contain the shipped one, so the assertion above would catch it.
    expect("Slack rejected that. Try again later.").not.toContain(POST_FAILURE_MESSAGES.rejected);

    // And the adapter's own error text never reaches the screen in any
    // encoding — the inherited obligation on `postResultSchema`.
    for (const outcome of outcomes) {
      expect(outcome.sentence).not.toMatch(
        /\binvalid_auth\b|\bchannel_not_found\b|\bnot_in_channel\b/i,
      );
      expect(outcome.sentence).not.toMatch(/\b[1-5]\d{2}\b/);
    }
  });
});
