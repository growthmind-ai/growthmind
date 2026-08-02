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

  return {
    channelId: input.channelId,
    fallbackText: line,
    blocks: [{ type: "section", text: { type: "mrkdwn", text: line } }],
  };
}
