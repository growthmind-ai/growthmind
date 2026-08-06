import type { PostRequest } from "@growthmind/shared";

export interface RevokeAnnouncementInput {
  readonly channelId: string;

  readonly workspaceName: string;

  readonly revokedByName: string | null;
}

const UNKNOWN_REVOKER = "Someone in this workspace";

// B-055: the confirm dialog discloses the workspace-wide blast radius to the person
// pressing (AGENT_REVOKE_CONSEQUENCE), but the write itself never told anyone else.
// Same channel and shape as `buildTestPostMessage`, so the org learns the same way
// it learns a connection was made.
export function buildAgentRevokeAnnouncement(input: RevokeAnnouncementInput): PostRequest {
  const who = input.revokedByName ?? UNKNOWN_REVOKER;
  const line =
    `${who} revoked every key for ${input.workspaceName}. Anything that was calling us with ` +
    `one of those keys has stopped — reconnect it with a new key when you're ready.`;

  return {
    channelId: input.channelId,
    fallbackText: line,
    blocks: [{ type: "section", text: { type: "mrkdwn", text: line } }],
  };
}
