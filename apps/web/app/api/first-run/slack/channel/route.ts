// POST /api/first-run/slack/channel — the moment a channel is chosen (AD-4,
// AD-7, AD-16, AD-16a, AD-20, D7, D8).
//
// ###########################################################################
// # THE BODY NAMES A CHANNEL AND THE ROW IS CHOSEN BY THE ORGANIZATION (D7).
// #
// # `attachChannel(channelId)` takes a channel and NO connection id: the only
// # identifying values in its statement are `ctx.organizationId` and
// # `is_active`, and the one value that arrived from a payload appears solely
// # in the SET clause. So there is no parameter on this request through which
// # one organization could name another's connection — not a check that can
// # be forgotten, a shape in which the mistake is unwritable.
// ###########################################################################
//
// ── THE SUBMITTED ID IS PROVED AGAINST THE LIVE LIST BEFORE IT IS STAMPED ───
//
// `firstRunSlackChannelInputSchema` deliberately declines to guess Slack's id
// format — a regex that guessed wrong would refuse a real channel a founder
// picked from our own list — and its doc comment says the route proves
// membership of that list instead, "which is a stronger check than any shape".
// This is that proof, and it is the route's job because the list is only
// knowable here: it is fetched live, per organization, through the same AD-20
// port the picker itself reads (`@/lib/first-run/deps`).
//
// It is worth being precise about what the check buys, because it is not
// tenancy — the repository already made cross-org attachment unwritable. It
// buys the founder: a picker left open while the channel was archived, renamed
// away, or the bot removed from it would otherwise stamp an address that
// refuses every post for the life of the organization, while the screen says
// they chose. The failure would surface much later, as silence.
//
// ── A FAILED TEST POST DOES NOT ROLL BACK THE ATTACH (D8) ───────────────────
//
// The channel is chosen; delivery health is a separate fact with its own
// column. Undoing a correct pick because the first message did not land would
// send the founder back to a screen they had already completed, to redo a
// choice that was right. So the answer is a 200 carrying a failure outcome —
// the shape `slack/test` already returns, so the form's retryable logic keeps
// working without learning a second vocabulary.
import { createSlackConnectionsRepo, ensureProject, findUserNameById } from "@growthmind/db";
import { isDeliveryTarget } from "@growthmind/db";
import {
  describeTestPostOutcome,
  firstRunSlackChannelInputSchema,
  POST_FAILURE_MESSAGES,
} from "@growthmind/shared";

import {
  resolveChannelsFor,
  resolveFirstRunDeps,
  type FirstRunChannelListingRefusal,
  type FirstRunRouteDeps,
} from "@/lib/first-run/deps";
import { readRequestBody, refuseBody, requireTenant } from "@/lib/first-run/gate";
import {
  CHANNEL_NOT_LISTED,
  CHANNEL_UNAVAILABLE,
  CHANNELS_CALL_FAILED,
  CHANNELS_NOT_AUTHORISED,
  CHANNELS_UNAVAILABLE,
  NO_CHANNEL_CHOSEN,
  NO_WORKSPACE_CONNECTED,
  refusalResponse,
  type FirstRunGateRefusal,
} from "@/lib/first-run/refusals";
import { buildTestPostMessage } from "@/lib/first-run/slack-test-message";

export const dynamic = "force-dynamic";

/** AD-7's contract block: `{ channelId }`, `.trim().min(1)`, and NO tenancy key
 * — the organization comes from the session and the row it reaches comes from
 * the organization. */
export const inputSchema = firstRunSlackChannelInputSchema;

/**
 * The same four sentences the picker's own route answers with, for the same
 * four codes.
 *
 * A TOTAL RECORD, so a fifth code added to the port later is a compile error
 * here rather than a silent fallthrough (D9). The pair being identical to
 * `slack/channels`' is deliberate: both are answering "we could not read this
 * workspace's channels", and a founder who reads two different explanations of
 * one failure on two screens learns that the product is guessing.
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

  await ensureProject(deps.db, gate.ctx);

  // THE LIST FIRST, AND NOTHING IS WRITTEN UNTIL IT ANSWERS. It doubles as the
  // "is anything connected at all" read — an organization with no active
  // connection has no credential to open, so `no_connection` refuses here
  // before `attachChannel` can report the same absence as a null.
  const listing = await resolveChannelsFor(deps)(gate.ctx);
  if (!listing.ok) {
    return refusalResponse(LISTING_REFUSALS[listing.code]);
  }

  if (!listing.channels.some((channel) => channel.id === parsed.data.channelId)) {
    return refusalResponse(CHANNEL_NOT_LISTED);
  }

  // ONE `UPDATE … RETURNING`, never a read-then-write (D6): two members
  // finishing the picker at the same moment settle it in Postgres rather than
  // by racing a prior read.
  const connection = await createSlackConnectionsRepo(deps.db, gate.ctx).attachChannel(
    parsed.data.channelId,
  );
  if (connection === null) {
    return refusalResponse(NO_WORKSPACE_CONNECTED);
  }

  // THE SHIPPED PREDICATE RATHER THAN A `!`. The row was just stamped with a
  // trimmed, non-empty id, so this cannot fire today — it is here because
  // `channelId` is `string | null` on the summary (AD-4) and the alternative
  // is a non-null assertion, which is the thing that re-opens this hole one
  // refactor later.
  if (!isDeliveryTarget(connection)) {
    return refusalResponse(NO_CHANNEL_CHOSEN);
  }

  // "Nothing is connected" and "we cannot open what is connected" are different
  // mistakes with different next actions, and a founder told the wrong one goes
  // and does work that changes nothing. THE ATTACH ABOVE STANDS EITHER WAY.
  const poster = deps.poster ?? (await deps.posterFor?.(gate.ctx)) ?? null;
  if (poster === null) {
    return refusalResponse(CHANNEL_UNAVAILABLE);
  }

  // ATTRIBUTION, OFF THE ROW RATHER THAN OFF THE SESSION: a teammate can finish
  // the picker, and telling the channel that they connected the workspace would
  // be false.
  const connectedByName =
    connection.connectedByUserId === null
      ? null
      : await findUserNameById(deps.db, connection.connectedByUserId);

  // THE SHIPPED BUILDER, NOT A SECOND MESSAGE THAT ALSO MENTIONS THE CHANNEL.
  // EC-O1: this post is how the rest of the workspace learns that somebody
  // wired their organization to a channel, so a message that lost the
  // connector's name is a regression nobody would see.
  const result = await poster.post(
    buildTestPostMessage({
      channelId: connection.channelId,
      workspaceName: gate.ctx.organizationName,
      connectedByName,
    }),
  );

  const outcome = describeTestPostOutcome({ result, channelId: connection.channelId });

  // THE SHAPE `slack/test` ALREADY ANSWERS, field for field. A second
  // vocabulary for one fact is a second thing the form has to learn, and the
  // day the two disagree is the day a founder is told to retry something that
  // can never work.
  return Response.json({
    ok: result.ok,
    code: result.ok ? null : result.code,
    message: result.ok ? null : POST_FAILURE_MESSAGES[result.code],
    sentence: outcome.sentence,
    retryable: outcome.retryable,
    marksStepDone: outcome.marksStepDone,
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
