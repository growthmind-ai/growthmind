// GET /api/first-run/slack/channels — the picker's list, fetched live (AD-7,
// AD-8, AD-16, AD-16a, AD-20).
//
// ###########################################################################
// # NOTHING ON THIS PATH IS STORED, AND THAT IS THE DECISION RATHER THAN AN
// # OMISSION.
// #
// # AD-7: "no table, no sync, no staleness. A channel created a minute ago
// # must be pickable." That last sentence is the requirement. A founder who
// # has just been told to pick a destination will very often go and MAKE one
// # first, and a cached list refuses the only channel they actually want with
// # no error and no way to force a refresh — at which point the integration
// # looks broken. There is nothing here to invalidate because nothing is kept.
// ###########################################################################
//
// ── THE ROUTE NEVER SEES THE BOT TOKEN (AD-20) ──────────────────────────────
//
// Task 5.4 as written told this route to open the credential itself. That
// contradicts AD-20 and `slack-connections.repo.ts:28-31`, which reserve
// `openCredentialForOrg` for the delivery composition root and say plainly that
// no route, page or service may call it; AD-7's own CONFLICT RESOLUTION settles
// it in AD-20's favour. So what arrives is a per-org port built in
// `@/lib/first-run/deps` — the same shape as `posterFor`, one screen earlier —
// and the only verb this handler holds is "list". A response cannot leak what
// the handler never received.
//
// ── AN EMPTY LIST IS A LIE WHEN NOTHING IS CONNECTED ────────────────────────
//
// `[]` reads as "your workspace has no channels", which sends a founder off to
// create one they already have: work that cannot help, caused by us. So a
// missing connection is a NAMED refusal, and the four ways this can fail keep
// their own sentences because each names a different next action — reconnect,
// try again, connect first, or tell an operator.
import { firstRunSlackChannelsInputSchema } from "@growthmind/shared";

import {
  resolveChannelsFor,
  resolveFirstRunDeps,
  type FirstRunChannelListingRefusal,
  type FirstRunRouteDeps,
} from "@/lib/first-run/deps";
import { readRequestBody, refuseBody, requireTenant } from "@/lib/first-run/gate";
import {
  CHANNELS_CALL_FAILED,
  CHANNELS_NOT_AUTHORISED,
  CHANNELS_UNAVAILABLE,
  NO_WORKSPACE_CONNECTED,
  refusalResponse,
  type FirstRunGateRefusal,
} from "@/lib/first-run/refusals";

export const dynamic = "force-dynamic";

/** `z.strictObject({})` (AD-7). The workspace comes from the session and the
 * list comes from Slack; a body naming a workspace would be a body naming
 * somebody else's. */
export const inputSchema = firstRunSlackChannelsInputSchema;

/**
 * One sentence per refusal, keyed off the port's own code.
 *
 * A TOTAL RECORD RATHER THAN A SWITCH WITH A DEFAULT: a code added to
 * `FirstRunChannelListingRefusal` later becomes a compile error here instead of
 * falling through to whichever sentence somebody happened to make the fallback
 * (D9). Every one of the four is a different next action, which is why they are
 * not collapsed.
 */
const LISTING_REFUSALS: Record<FirstRunChannelListingRefusal, FirstRunGateRefusal> = {
  no_connection: NO_WORKSPACE_CONNECTED,
  unreadable_credential: CHANNELS_UNAVAILABLE,
  not_authorised: CHANNELS_NOT_AUTHORISED,
  call_failed: CHANNELS_CALL_FAILED,
};

export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  // NO `ensureProject`. This route reads a vendor's list and writes nothing of
  // ours, so there is no row for a project to hang off — the same reasoning
  // `analytics/discover` gives for leaving the project row alone.
  //
  // ORG-SCOPED, NOT ACTOR-SCOPED (D1, D2). The port is keyed on the tenant
  // context and on nothing else, so a teammate who set nothing up gets the same
  // list the founder who connected the workspace does.
  const listing = await resolveChannelsFor(deps)(gate.ctx);

  if (!listing.ok) {
    return refusalResponse(LISTING_REFUSALS[listing.code]);
  }

  // `{ id, name }` AND NOTHING ELSE. `SlackChannelChoice` is the only shape
  // that crosses this boundary — no token, no team id, no vendor flags.
  return Response.json({ ok: true, channels: listing.channels });
}

export async function GET(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
