// THE CHANNEL PICKER'S LIST — fetched live at pick time, stored nowhere (AD-7).
//
// ###########################################################################
// # AD-7's WHOLE CLAIM: "no table, no sync, no staleness. A channel created a
// # minute ago must be pickable."
// #
// # That last sentence is the requirement, not the flourish. A founder who has
// # just been told to pick a destination will very often go and MAKE one first
// # — a `#growth` channel that did not exist when they opened the page. A
// # cached list refuses the only channel they actually want, with no error and
// # no way to force a refresh, and the founder concludes the integration is
// # broken. There is nothing to invalidate here, because nothing is stored.
// ###########################################################################
//
// WHAT THIS FILE OWNS, AND WHAT THE ADAPTER OWNS
//
// The wire — the request shape, the bounded cursor walk, the timeout, and Slack's own
// error vocabulary — belongs to `@growthmind/adapters`, beside every other vendor call
// in this repository and beside the `zod` that validates the response (`apps/web`
// declares none, WIRE-Z1). What is here is the part that is a PRODUCT decision and not
// a vendor one: which scopes this app asks for, what order a human should see the
// answers in, and what a founder should do about each way it can fail.
//
// WHY THE SCOPES LIVE IN THIS FILE
//
// They are one fact that would otherwise be stated twice: the scopes the authorize url
// asks Slack for, and the permissions this listing needs in order to work. A start
// route that spelled its own scope string would produce a workspace that connects
// successfully and then lists nothing — a dead end with no error anywhere the founder
// can see, because Slack answers `missing_scope` on a call they never watch. One
// exported constant, imported by the authorize url builder (D9).
import { listSlackConversations } from "@growthmind/adapters";
import type { SlackConversation } from "@growthmind/adapters";

/**
 * WHAT THIS APP ASKS SLACK FOR, ONCE.
 *
 * - `channels:read` — list public channels. Without it there is no picker at all.
 * - `groups:read` — list the private channels the bot has been invited to. Findings
 *   about a funnel are exactly the kind of thing a team keeps in a private room, and a
 *   picker that silently omits every private channel looks like the channel is gone.
 * - `chat:write` — post. Not padding: the entire purpose of picking a channel is to
 *   deliver findings into it, and a connection that can list but not post is a
 *   completed setup that never delivers anything. Scopes are granted at authorize time,
 *   so omitting it here would strand every OAuth-connected workspace behind a
 *   re-consent this product has no screen for.
 *
 * An array with its joined form derived beside it, rather than one comma-separated
 * literal, so a reader sees three decisions instead of parsing a string.
 */
export const SLACK_OAUTH_SCOPES = ["channels:read", "groups:read", "chat:write"] as const;

/** Slack's `scope` parameter is comma-separated. Derived, never spelled a second time. */
export const SLACK_OAUTH_SCOPE_PARAM = SLACK_OAUTH_SCOPES.join(",");

/** What the picker renders, and the ONLY thing that crosses this boundary. No token, no
 *  team id, no vendor flags — a route returning this cannot leak what it never
 *  received. */
export interface SlackChannelChoice {
  readonly id: string;
  readonly name: string;
}

/**
 * Two codes, because there are exactly two different next actions.
 *
 * `not_authorised` — the token is refused, or the install lacks `channels:read` /
 * `groups:read`. Retrying achieves nothing; a human has to reconnect the workspace.
 * This is the realistic one: a workspace connected by pasting a bot token from an app
 * whose scopes somebody picked by hand.
 *
 * `call_failed` — Slack is up but did not serve this call, or we could not read what it
 * sent. Pressing the button again is the right move.
 *
 * EVERY OTHER SLACK CODE COLLAPSES INTO `call_failed`, and that direction is chosen
 * rather than defaulted (D10). Telling a founder to go and reconnect their workspace on
 * the strength of an error we could not classify sends them to fix something we have no
 * evidence is broken; asking them to try again costs one click and is honest about
 * every unknown failure.
 */
export type ListChannelsRefusalCode = "not_authorised" | "call_failed";

export type ListChannelsResult =
  | { readonly ok: true; readonly channels: readonly SlackChannelChoice[] }
  | { readonly ok: false; readonly code: ListChannelsRefusalCode };

/** AD-8's one seam, threaded through to the adapter. The fetch is injected so this is
 *  drivable with no network, and so "no connection meant no outbound call" is
 *  assertable rather than assumed. */
export interface ListChannelsDeps {
  readonly fetch: typeof globalThis.fetch;
}

/**
 * WHAT "MOST PLAUSIBLE DESTINATION FIRST" MEANS HERE, PRECISELY.
 *
 * It means "the ones that will actually work when picked" — NOT "the ones we guessed
 * you want". There is a tempting version of this function that ranks a channel called
 * `#growth` above one called `#random`, and it is a keyword classifier over a company's
 * private vocabulary: it would rank `#wachstum` last, and it would float a dead channel
 * above the busy one every time somebody's naming did not match ours (D10). The founder
 * is looking at their own channel names and already knows which one they want. Our job
 * is only to stop the top of the list being full of channels a post would bounce off.
 *
 * So the one signal used is membership. Posting to a public channel the bot has not
 * joined fails with `not_in_channel`, and that failure arrives LATER — on the test post,
 * after the founder believed they had finished. A channel Slack says the bot is already
 * in is a channel the very next step succeeds on.
 *
 * `isMember: null` means Slack did not say, which is not the same as `false`, so those
 * rank between the two rather than being treated as a refusal to join.
 */
function plausibilityRank(channel: SlackConversation): number {
  if (channel.isMember === true) return 0;
  if (channel.isMember === null) return 1;
  return 2;
}

/**
 * Ties break ALPHABETICALLY BY NAME, on raw code points rather than `localeCompare`, so
 * two identical workspaces produce byte-identical lists on any machine and in any
 * locale. Vendor order is never relied on: it is undocumented, and depending on it
 * would let the picker reshuffle itself between two requests a second apart.
 */
function byPlausibility(left: SlackConversation, right: SlackConversation): number {
  const rank = plausibilityRank(left) - plausibilityRank(right);
  if (rank !== 0) return rank;

  if (left.name < right.name) return -1;
  if (left.name > right.name) return 1;
  return 0;
}

/**
 * Lists the channels this workspace's bot can be pointed at. NEVER THROWS.
 *
 * The token is handed to the adapter and appears in nothing this function returns: the
 * failure arm carries a two-member union, so there is no expression here through which
 * a token, a url or a response body could reach a caller.
 *
 * An empty successful list is a legitimate answer and is returned as one. It is the
 * CALLER's job never to render that as "your workspace has no channels" when the real
 * situation is a missing connection — an empty list in that case sends a founder off to
 * create a channel they already have, which is work that cannot help and that we caused.
 */
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

  const offered = result.conversations.filter(
    // Slack was asked to exclude these and says it does. Checked again because that is
    // the vendor's promise rather than ours, and offering an archived channel hands the
    // founder a destination that refuses every post they will ever send to it.
    (conversation) => conversation.isArchived !== true,
  );

  return {
    ok: true,
    channels: offered
      .toSorted(byPlausibility)
      .map((conversation) => ({ id: conversation.id, name: conversation.name })),
  };
}
