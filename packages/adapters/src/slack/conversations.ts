// The cursor comes from the other end of a socket, so the walk is bounded twice: bounded
// response reading, plus an EXPLICIT page cap. This package forbids unbounded loops and
// asserts it structurally; a `for` with a literal bound is what satisfies that.
import type { PostFailureCode } from "@growthmind/shared";

import { REQUEST_TIMEOUT_MS, SLACK_CONVERSATIONS_LIST_URL } from "./constants";
import type { SlackConversation } from "./envelopes";
import { parseSlackConversationsPage, readSlackJsonBody } from "./envelopes";
import { mapSlackError } from "./errors";

const SLACK_CONVERSATION_TYPES = "public_channel,private_channel";

const CHANNELS_PER_PAGE = 200;

// The explicit cap: five pages. Hitting it returns what was collected, never a failure.
const MAX_CHANNEL_PAGES = 5;

export interface SlackConversationsConfig {
  // Presented as a Bearer credential and surfaced nowhere: the failure arm carries a
  // `PostFailureCode` and nothing else, so THE BOT TOKEN CANNOT REACH A RETURNED FAILURE.
  readonly botToken: string;
}

export interface SlackConversationsDeps {
  readonly fetch: typeof globalThis.fetch;
}

export type ListSlackConversationsResult =
  | { readonly ok: true; readonly conversations: readonly SlackConversation[] }
  | { readonly ok: false; readonly code: PostFailureCode };

function pageUrl(cursor: string | null): string {
  const search = new URLSearchParams({
    types: SLACK_CONVERSATION_TYPES,
    limit: String(CHANNELS_PER_PAGE),
    exclude_archived: "true",
  });

  if (cursor !== null) search.set("cursor", cursor);

  return `${SLACK_CONVERSATIONS_LIST_URL}?${search.toString()}`;
}

// Walks a workspace's channels. NEVER THROWS — every exit is a result — and there is NO
// RETRY LOOP: a human is waiting at the picker, so a 429 returns retryable `call_failed`.
export async function listSlackConversations(
  config: SlackConversationsConfig,
  deps: SlackConversationsDeps,
): Promise<ListSlackConversationsResult> {
  try {
    const authorization = `Bearer ${config.botToken}`;
    const conversations: SlackConversation[] = [];
    const seen = new Set<string>();

    let cursor: string | null = null;

    for (let page = 0; page < MAX_CHANNEL_PAGES; page += 1) {
      let response: Response;
      try {
        response = await deps.fetch(pageUrl(cursor), {
          headers: { authorization, accept: "application/json" },
          redirect: "manual",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        return { ok: false, code: "call_failed" };
      }

      const envelope = parseSlackConversationsPage(await readSlackJsonBody(response));

      if (envelope === null) return { ok: false, code: "call_failed" };
      if (!envelope.ok) return { ok: false, code: mapSlackError(envelope.error) };
      if (!response.ok) return { ok: false, code: "call_failed" };

      for (const conversation of envelope.value.conversations) {
        if (seen.has(conversation.id)) continue;

        seen.add(conversation.id);
        conversations.push(conversation);
      }

      cursor = envelope.value.nextCursor;
      if (cursor === null) break;
    }

    return { ok: true, conversations };
  } catch {
    return { ok: false, code: "call_failed" };
  }
}
