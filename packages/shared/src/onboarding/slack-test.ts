import { POST_FAILURE_MESSAGES } from "../delivery/messages";
import type { PostFailureCode, PostResult } from "../delivery/poster";
import { isRetryablePostFailure } from "../delivery/poster";
import {
  SLACK_MUST_INVITE_THE_BOT,
  SLACK_MUST_RECONNECT,
  SLACK_TEST_SUCCESS_TEMPLATE,
} from "./messages";

export type TestPostInput = {
  readonly result: PostResult;

  // `PostResult` carries no channel; these come from the stored row, not a payload.
  readonly channelId: string;

  // What the founder is shown, which is not the address. Required so a TS caller
  // cannot omit it; defaulted below because props erase at runtime.
  readonly channelLabel: string | null;
};

export type TestPostOutcome = {
  readonly sentence: string;
  readonly retryable: boolean;
  readonly marksStepDone: boolean;
};

// `POST_FAILURE_MESSAGES` states facts only; the next action differs per surface,
// so it is appended here. Both once instructed, and they contradicted each other.
const ONBOARDING_CLAUSE: Readonly<Record<PostFailureCode, string | null>> = {
  call_failed: null,
  rejected: null,
  not_authorised: SLACK_MUST_RECONNECT,

  channel_unavailable: SLACK_MUST_INVITE_THE_BOT,
};

function failureSentence(code: PostFailureCode): string {
  const shipped = POST_FAILURE_MESSAGES[code];
  const clause = ONBOARDING_CLAUSE[code];

  return clause === null ? shipped : `${shipped} ${clause}`;
}

export function describeTestPostOutcome(input: TestPostInput): TestPostOutcome {
  if (input.result.ok) {
    return {
      sentence: SLACK_TEST_SUCCESS_TEMPLATE.replaceAll(
        "{channel}",
        input.channelLabel?.trim() || input.channelId,
      ),
      retryable: false,
      marksStepDone: true,
    };
  }

  return {
    sentence: failureSentence(input.result.code),
    // `retryable` gates the second "Try again": does pressing again, unchanged,
    // fix it? No for `channel_unavailable` — a human invites the bot in Slack.
    retryable: isRetryablePostFailure(input.result.code),
    marksStepDone: false,
  };
}
