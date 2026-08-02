// THE SLACK TEST POST, DESCRIBED (O-008, FR-O11, UX Flow D).
//
// ###########################################################################
// # THE ONE DISTINCTION THIS MODULE EXISTS TO MAKE.
// #
// # A founder staring at a failed test message needs exactly one thing: CAN
// # THEY PRESS THE BUTTON AGAIN, OR DOES A HUMAN HAVE TO GO AND FIX SOMETHING?
// # `postFailureCodeSchema` paid for four codes precisely so that question has
// # an answer, and a surface that renders all four the same way throws it away
// # and leaves the founder pressing a button that can never work.
// #
// # `retryable` IS DERIVED FROM `isRetryablePostFailure`, never carried as a
// # second hand-set boolean. The shipped comment on that function says why: "a
// # boolean the adapter sets by hand is a boolean that eventually contradicts
// # its own code."
// #
// # AND `marksStepDone` IS FALSE ON EVERY FAILURE. Flow D: "in all four cases,
// # setup is not broken." The step is not done — a transient failure has proved
// # nothing about the connection, and claiming otherwise would be a fake
// # confirmation — and it is not an error state that blocks the sequence
// # either: "Skip for now" is still there and still reaches step 5. That is D8,
// # stated as copy: a failing side effect never fails the main flow.
// ###########################################################################
//
// ── B3 / FR-O22 — ONE HOME ──────────────────────────────────────────────────
//
// Every sentence here is BUILT ON the shipped `POST_FAILURE_MESSAGES`, which
// already carries the plain-English audit, the "nothing about what we found has
// changed" rule and four genuinely different next steps. This module adds the
// ONBOARDING-SPECIFIC clause the UX spec makes normative on top of it; it does
// not paraphrase, shorten or re-word what the delivery lane already says. A
// second vocabulary for the same four codes drifts within a week, and then two
// screens tell one customer two different things about one Slack failure.
//
// ── WHY THE INPUT CARRIES THE CHANNEL ───────────────────────────────────────
//
// ADD §5 declares `describeTestPostOutcome(PostResult)`, and §9 requires the
// success sentence to NAME THE CHANNEL. `PostResult`'s success arm carries
// `messageRef` and nothing else — there is no channel on it. Substituting the
// channel at the call site would put a customer-facing sentence outside
// `packages/shared`, which FR-O22 forbids and which the render-purity scan
// would then fail. So the input is an object carrying both, and the channel is
// read from the `slack_connections` row (FR-O13) rather than from a payload.

import { POST_FAILURE_MESSAGES } from "../delivery/messages";
import type { PostFailureCode, PostResult } from "../delivery/poster";
import { isRetryablePostFailure } from "../delivery/poster";
import {
  SLACK_MUST_INVITE_THE_BOT,
  SLACK_MUST_RECONNECT,
  SLACK_TEST_SUCCESS_TEMPLATE,
} from "./messages";

/** What the step hands this module. */
export type TestPostInput = {
  readonly result: PostResult;
  /** FR-O13: read from the connection row, never accepted from a payload. */
  readonly channelId: string;
};

/** The three things the step needs to know. */
export type TestPostOutcome = {
  readonly sentence: string;
  readonly retryable: boolean;
  readonly marksStepDone: boolean;
};

/**
 * The onboarding clause, per code — the thing the founder cannot work out on
 * their own.
 *
 * The shipped sentence for `not_authorised` says someone will need to
 * reconnect; the clause says that pressing the button again is not one of their
 * options. Without it, a primary "Try again" is the obvious thing to build and
 * it can never succeed.
 *
 * THE TWO SILENT CODES ARE SILENT ON PURPOSE. `call_failed`'s shipped sentence
 * already says we will try again, and `rejected`'s already says sending the
 * same thing again would not help — a clause repeating either would be this
 * module authoring a second answer to a question the delivery lane has already
 * answered.
 */
const ONBOARDING_CLAUSE: Readonly<Record<PostFailureCode, string | null>> = {
  call_failed: null,
  rejected: null,
  not_authorised: SLACK_MUST_RECONNECT,
  // A DIFFERENT JOB, AND IT POINTS THE OPPOSITE WAY.
  //
  // "Reconnect Slack" and "invite the bot" are not interchangeable, and a
  // founder told the wrong one goes and does work that changes nothing — but
  // the difference that matters here is the DIRECTION. `not_authorised`
  // withholds a retry that can never succeed; `channel_unavailable` on a
  // stamped address is fixed by a step over in Slack followed by exactly the
  // press this clause used to forbid.
  //
  // The address is stamped by the time this code is reachable, and
  // `attachChannel` never moves a chosen one, so the clause that once said
  // "pick another channel — trying again will not help" named an act the
  // product does not serve and denied the one that works.
  channel_unavailable: SLACK_MUST_INVITE_THE_BOT,
};

function failureSentence(code: PostFailureCode): string {
  const shipped = POST_FAILURE_MESSAGES[code];
  const clause = ONBOARDING_CLAUSE[code];

  // VERBATIM AND ENTIRE, then the clause. Never a rewrite of the shipped
  // sentence, and never the adapter's own error text — the inherited obligation
  // on `postResultSchema` is that the vendor's words never reach a customer.
  return clause === null ? shipped : `${shipped} ${clause}`;
}

/**
 * What the test post proved, in one sentence a founder can act on.
 *
 * SUCCESS NAMES THE CHANNEL. "A test message was sent" is not a confirmation —
 * the founder then has to go and look somewhere, and we know where. The second
 * half of that sentence is the answer to OQ-O6: the test message IS the
 * announcement to the rest of the workspace, so a teammate learns from the
 * channel rather than from a notification system this sprint does not build.
 *
 * `retryable` IS FALSE ON SUCCESS. A retry offered beside a success is a control
 * with no meaning.
 *
 * `messageRef` NEVER REACHES THE SENTENCE. It is the channel's internal handle
 * for what it accepted, and a raw internal id rendered at a customer is D9's
 * failure whether or not anybody notices it is one.
 */
export function describeTestPostOutcome(input: TestPostInput): TestPostOutcome {
  if (input.result.ok) {
    return {
      sentence: SLACK_TEST_SUCCESS_TEMPLATE.replaceAll("{channel}", input.channelId),
      retryable: false,
      marksStepDone: true,
    };
  }

  return {
    sentence: failureSentence(input.result.code),
    // DERIVED, NEVER RESTATED. The shipped function is the only opinion about
    // which failures fix themselves, so a code added to the enum later inherits
    // the right answer here instead of falling through to a local default.
    //
    // AND `channel_unavailable` STAYS FALSE, EVEN THOUGH ITS CLAUSE NOW ENDS IN
    // "send the test message again". The two do not disagree. This flag answers
    // "does pressing again, right now, with nothing changed, fix it?" — and it
    // does not: a person has to invite the bot over in Slack first. What the
    // flag gates is the SECOND button; the send button is on the card in every
    // unsettled state and, on a stamped address, does nothing but re-post. A
    // `true` here would put a "Try again" beside it calling the same post twice
    // over, which is a duplicate control (D3), not a next action. Flipping the
    // shipped derivation instead would be worse still: the delivery lane would
    // retry a terminal failure forever, which is the one thing four codes were
    // paid for to prevent.
    retryable: isRetryablePostFailure(input.result.code),
    marksStepDone: false,
  };
}
