import { toPostRequest } from "@growthmind/core";
import type { PostRequest } from "@growthmind/shared";

export interface TestPostMessageInput {
  readonly channelId: string;

  readonly workspaceName: string;

  readonly connectedByName: string | null;
}

const UNKNOWN_CONNECTOR = "Someone in this workspace";

export function buildTestPostMessage(input: TestPostMessageInput): PostRequest {
  const who = input.connectedByName ?? UNKNOWN_CONNECTOR;
  const line =
    `${who} connected ${input.workspaceName} to this channel. ` +
    `What we find in your product arrives here from now on.`;

  // The workspace name and the connecting person's display name are both settable by anyone in
  // the customer's workspace, and this is the first message we ever send them.
  return toPostRequest({
    channelId: input.channelId,
    blocks: [{ kind: "section", text: line }],
    fallbackText: line,
  });
}
