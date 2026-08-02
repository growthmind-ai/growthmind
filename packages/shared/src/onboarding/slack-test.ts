import { POST_FAILURE_MESSAGES } from "../delivery/messages";
import type { PostFailureCode, PostResult } from "../delivery/poster";
import { isRetryablePostFailure } from "../delivery/poster";
import {
  SLACK_MUST_PICK_ANOTHER_CHANNEL,
  SLACK_MUST_RECONNECT,
  SLACK_TEST_SUCCESS_TEMPLATE,
} from "./messages";

export type TestPostInput = {
  readonly result: PostResult;

  readonly channelId: string;
};

export type TestPostOutcome = {
  readonly sentence: string;
  readonly retryable: boolean;
  readonly marksStepDone: boolean;
};

const ONBOARDING_CLAUSE: Readonly<Record<PostFailureCode, string | null>> = {
  call_failed: null,
  rejected: null,
  not_authorised: SLACK_MUST_RECONNECT,

  channel_unavailable: SLACK_MUST_PICK_ANOTHER_CHANNEL,
};

function failureSentence(code: PostFailureCode): string {
  const shipped = POST_FAILURE_MESSAGES[code];
  const clause = ONBOARDING_CLAUSE[code];

  return clause === null ? shipped : `${shipped} ${clause}`;
}

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

    retryable: isRetryablePostFailure(input.result.code),
    marksStepDone: false,
  };
}
