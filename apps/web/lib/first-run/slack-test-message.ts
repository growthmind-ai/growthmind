// THE TEST MESSAGE, AND WHY IT IS AN ANNOUNCEMENT RATHER THAN A PING (O-008,
// FR-O11, EC-O1, OQ-O6).
//
// ###########################################################################
// # THE TEST MESSAGE IS HOW THE REST OF THE WORKSPACE FINDS OUT.
// #
// # EC-O1 asks how a teammate learns that somebody wired their organization
// # up to a channel. AD-24 answers it by stating plainly that this sprint
// # ships NO in-app notification system — so the Slack post IS the
// # announcement. That is why `slack_connections.connected_by_user_id` exists
// # (AD-8 says so on the column), and it is why a message reading only "this
// # works" would be a bug: a teammate seeing it would have no way to tell who
// # connected their organization to a channel, or which organization it even
// # was.
// #
// # So the message names THREE things and nothing else: the workspace, the
// # person who connected it, and what arrives here from now on.
// ###########################################################################
//
// ── THE CREDENTIAL IS NOT IN SCOPE IN THIS FILE, AND MUST NEVER BE ──────────
//
// The bot token is opened once, in the composition root, and travels one
// function call into the adapter that speaks to the vendor. Nothing here holds
// it, so no sentence below can carry it, in any encoding.
//
// ── A DEFERRAL, RECORDED RATHER THAN SMUGGLED ───────────────────────────────
//
// FR-O22 puts every customer-facing string for this surface in
// `packages/shared/src/onboarding/messages.ts`, which is separately audited
// for durations, jargon and a two-name proper-noun allow-list. The two
// sentences below are customer-facing — they land in a customer's channel —
// and they belong in that file. They are here because the wave that owns this
// route does not own that module, and a sentence in two homes drifts within a
// week. **Whoever next edits the onboarding copy module should lift these into
// it and import them from here**, at which point this file becomes assembly
// only. Recorded as a P1 in the wave's report rather than left as a surprise.

import type { PostRequest } from "@growthmind/shared";

export interface TestPostMessageInput {
  /** FR-O13: read from the stored row, never accepted from a payload. */
  readonly channelId: string;
  /** The organization's own name, from the session's tenant context. */
  readonly workspaceName: string;
  /**
   * The person on `connected_by_user_id`, by a name a human reads.
   *
   * ATTRIBUTION, NOT THE ACTOR. It is whoever CONNECTED the channel, which is
   * not necessarily whoever pressed the test button — a teammate can send the
   * test, and telling the channel that they connected it would be false. A raw
   * user id would be a machine identifier in front of a reader, so an
   * unresolvable name degrades to a phrase rather than to an id.
   */
  readonly connectedByName: string | null;
}

/** What the message says when the connector's name cannot be resolved — their
 * account was deleted, or the row predates the column. Never an id. */
const UNKNOWN_CONNECTOR = "Someone in this workspace";

/**
 * One message, ready for the shipped `DeliveryPoster` port.
 *
 * `fallbackText` IS NEVER EMPTY and carries the whole sentence rather than a
 * label: it is what a phone's notification preview and a screen reader read,
 * and a blocks-only message is silent in both.
 */
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
