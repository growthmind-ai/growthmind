import { listSlackConversations } from "@growthmind/adapters";
import type { SlackConversation } from "@growthmind/adapters";

// `chat:write` is load-bearing, not padding: without it a workspace connects, lists
// channels, and can never post — and scopes are granted at authorize time, so the fix is a
// re-consent screen this product does not have.
export const SLACK_OAUTH_SCOPES = ["channels:read", "groups:read", "chat:write"] as const;

export const SLACK_OAUTH_SCOPE_PARAM = SLACK_OAUTH_SCOPES.join(",");

export interface SlackChannelChoice {
  readonly id: string;
  readonly name: string;
}

export type ListChannelsRefusalCode = "not_authorised" | "call_failed";

export type ListChannelsResult =
  | { readonly ok: true; readonly channels: readonly SlackChannelChoice[] }
  | { readonly ok: false; readonly code: ListChannelsRefusalCode };

export interface ListChannelsDeps {
  readonly fetch: typeof globalThis.fetch;
}

// Membership is the only signal: posting to a public channel the bot has not joined fails
// with `not_in_channel` on the test post, after the founder believed they had finished.
function plausibilityRank(channel: SlackConversation): number {
  if (channel.isMember === true) return 0;
  if (channel.isMember === null) return 1;
  return 2;
}

function byPlausibility(left: SlackConversation, right: SlackConversation): number {
  const rank = plausibilityRank(left) - plausibilityRank(right);
  if (rank !== 0) return rank;

  if (left.name < right.name) return -1;
  if (left.name > right.name) return 1;
  return 0;
}

export async function listChannels(
  botToken: string,
  deps: ListChannelsDeps,
): Promise<ListChannelsResult> {
  const result = await listSlackConversations({ botToken }, { fetch: deps.fetch });

  if (!result.ok) {
    return {
      ok: false,
      code: result.code === "not_authorised" ? "not_authorised" : "call_failed",
    };
  }

  const offered = result.conversations.filter((conversation) => conversation.isArchived !== true);

  return {
    ok: true,
    channels: offered
      .toSorted(byPlausibility)
      .map((conversation) => ({ id: conversation.id, name: conversation.name })),
  };
}
