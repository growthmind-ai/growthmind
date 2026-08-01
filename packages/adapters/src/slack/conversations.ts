// LISTING A WORKSPACE'S CHANNELS — the wire half of AD-7's live channel picker.
//
// What is here and what is deliberately NOT
//
// This module owns the vendor call: the request shape, the bounded cursor walk, the
// timeout, and the classification of Slack's own error vocabulary. It does not decide
// what a founder sees. Ordering, filtering and the two-way "what should the founder do
// about this" split live in `apps/web/lib/slack/channels.ts`, because those are product
// decisions and this package answers to a vendor.
//
// The walk is bounded twice, and that is not belt-and-braces
//
// The cursor comes from the other end of a socket. A remote that returns the same
// cursor forever — a bug, a proxy rewriting bodies, or malice — turns `while (cursor)`
// into a request loop that holds a web request open until something else kills it. So
// the page count is capped explicitly AND each request carries its own timeout. This
// package forbids unbounded loops outright and asserts it structurally; a `for` with a
// literal bound is the shape that satisfies it.
//
// The cursor is a QUERY PARAMETER on a compile-time-constant url, never a url Slack
// hands back. The "follow the `next` link verbatim" hazard that makes
// `../posthog/client.ts` re-check its origin on every hop therefore does not arise
// here at all: the remote never gets to name a host.
import type { PostFailureCode } from "@growthmind/shared";

import { REQUEST_TIMEOUT_MS, SLACK_CONVERSATIONS_LIST_URL } from "./constants";
import type { SlackConversation } from "./envelopes";
import { parseSlackConversationsPage, readSlackJsonBody } from "./envelopes";
import { mapSlackError } from "./errors";

/** The conversation types the picker offers, matching the `channels:read` and
 *  `groups:read` scopes the authorize url asks for. */
const SLACK_CONVERSATION_TYPES = "public_channel,private_channel";

/**
 * Rows per page. Slack's documented maximum for this method is 1000 and its own
 * guidance is to stay well below it; 200 is the value the docs recommend, and it keeps
 * each response small enough that the bounded reader never has to work hard.
 */
const CHANNELS_PER_PAGE = 200;

/**
 * Five pages, so 1,000 channels.
 *
 * Past that a scrolling picker is the wrong interface anyway and a founder is going to
 * search rather than read. Hitting the cap returns what was collected rather than
 * failing: a founder's channel is overwhelmingly likely to be on the first page, and a
 * partial list they can pick from beats a refusal they cannot act on.
 */
const MAX_CHANNEL_PAGES = 5;

export interface SlackConversationsConfig {
  /**
   * The workspace's bot token, decrypted for the lifetime of one listing. Presented as
   * a Bearer credential and surfaced nowhere: the failure arm below carries a
   * `PostFailureCode` and nothing else, so no url, body or token has a route to a
   * caller that did not succeed.
   */
  readonly botToken: string;
}

export interface SlackConversationsDeps {
  readonly fetch: typeof globalThis.fetch;
}

/**
 * The vendor's verdict, in the vocabulary `./errors.ts` already audits.
 *
 * `PostFailureCode` rather than a second enum invented here, because Slack answers
 * `conversations.list` and `chat.postMessage` from the same error vocabulary
 * (`invalid_auth`, `missing_scope`, `ratelimited`) and two mappings over one vocabulary
 * drift within a week. What the codes MEAN for a founder differs between the two
 * surfaces, and that difference belongs to the surface, not here.
 */
export type ListSlackConversationsResult =
  | { readonly ok: true; readonly conversations: readonly SlackConversation[] }
  | { readonly ok: false; readonly code: PostFailureCode };

function pageUrl(cursor: string | null): string {
  const search = new URLSearchParams({
    types: SLACK_CONVERSATION_TYPES,
    limit: String(CHANNELS_PER_PAGE),
    // Slack's own filter, so an archived channel costs no bytes on the wire. The caller
    // filters again: this is the vendor's promise rather than ours.
    exclude_archived: "true",
  });

  if (cursor !== null) search.set("cursor", cursor);

  return `${SLACK_CONVERSATIONS_LIST_URL}?${search.toString()}`;
}

/**
 * Walks a workspace's channels. NEVER THROWS — every exit is a result.
 *
 * The caller is a web request with a person waiting, so there is NO RETRY LOOP: a 429
 * comes back as the retryable `call_failed` and the founder presses the button again.
 * The poll client's exponential backoff exists so a background run survives a throttle;
 * a human staring at a picker must not be made to wait through five sleeps.
 */
export async function listSlackConversations(
  config: SlackConversationsConfig,
  deps: SlackConversationsDeps,
): Promise<ListSlackConversationsResult> {
  // The outer guard, so "never throws" is a property of this function's shape rather
  // than of the branch set it happens to have today.
  try {
    const authorization = `Bearer ${config.botToken}`;
    const conversations: SlackConversation[] = [];
    // The list is live by design (AD-7), so it can change underneath a cursor walk and
    // return one conversation on two pages. One id, one row (D3).
    const seen = new Set<string>();

    let cursor: string | null = null;

    for (let page = 0; page < MAX_CHANNEL_PAGES; page += 1) {
      let response: Response;
      try {
        response = await deps.fetch(pageUrl(cursor), {
          headers: { authorization, accept: "application/json" },
          // A redirect goes wherever the upstream points; treat one as a response to be
          // read, never as a hop to follow — this request carries a bot token.
          redirect: "manual",
          // Per request, not per walk. Without it a host that accepts the connection
          // and never answers holds the picker open indefinitely.
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        // Transport fault, DNS, TLS, or the timeout above. None of them says anything
        // about the token, so all of them are retryable.
        return { ok: false, code: "call_failed" };
      }

      // HTTP 200 IS NOT SUCCESS. Slack answers this method with 200 and
      // `{"ok":false,"error":"missing_scope"}` — the status says the call was served,
      // the body says nothing was listed.
      const envelope = parseSlackConversationsPage(await readSlackJsonBody(response));

      // `null` is "we could not read this at all": a proxy's html page, an empty body,
      // a success claim with no `channels` array. Not knowing what happened is not the
      // same as Slack refusing, and only the second is grounds for telling somebody
      // their credentials are wrong.
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
