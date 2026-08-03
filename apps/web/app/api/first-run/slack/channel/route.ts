// The submitted channel is proved to be in the server-fetched list before it is
// stamped — a picker left open on an archived channel would otherwise stamp an
// address that refuses every post, and the failure surfaces later as silence.
// `attachChannel` fills an empty address and never moves a chosen one: the
// delivery ledger's identity is `(organization_id, finding_id, channel_id)`, so
// re-pointing forks it and re-delivers the organization's whole backlog (D12).
// A failed test post does not roll back the attach (D8) — the channel is chosen;
// delivery health is a separate fact, returned as a 200 carrying the outcome.
import { createSlackConnectionsRepo, ensureProject, findUserNameById } from "@growthmind/db";
import { isDeliveryTarget } from "@growthmind/db";
import {
  channelLabel,
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
  channelAlreadyChosen,
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

export const inputSchema = firstRunSlackChannelInputSchema;

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

  const listing = await resolveChannelsFor(deps)(gate.ctx);
  if (!listing.ok) {
    return refusalResponse(LISTING_REFUSALS[listing.code]);
  }

  if (!listing.channels.some((channel) => channel.id === parsed.data.channelId)) {
    return refusalResponse(CHANNEL_NOT_LISTED);
  }

  const connections = createSlackConnectionsRepo(deps.db, gate.ctx);
  // The name comes from the listing the choice was just proved against, so the row
  // is stamped with the same words the founder read on the picker (B-037).
  const chosen = listing.channels.find((channel) => channel.id === parsed.data.channelId);
  const connection = await connections.attachChannel(parsed.data.channelId, chosen?.name ?? null);
  if (connection === null) {
    // The repository reports only that it changed no row, so which of the two
    // reasons applies is read AFTER the write that lost, never before it (D6).
    const existing = await connections.getActiveForOrg();
    if (existing === null) {
      return refusalResponse(NO_WORKSPACE_CONNECTED);
    }

    return refusalResponse(
      isDeliveryTarget(existing)
        ? channelAlreadyChosen(channelLabel(existing) ?? existing.channelId)
        : NO_CHANNEL_CHOSEN,
    );
  }

  if (!isDeliveryTarget(connection)) {
    return refusalResponse(NO_CHANNEL_CHOSEN);
  }

  const poster = deps.poster ?? (await deps.posterFor?.(gate.ctx)) ?? null;
  if (poster === null) {
    return refusalResponse(CHANNEL_UNAVAILABLE);
  }

  // Off the row rather than the session: a teammate can finish the picker.
  const connectedByName =
    connection.connectedByUserId === null
      ? null
      : await findUserNameById(deps.db, connection.connectedByUserId);

  const result = await poster.post(
    buildTestPostMessage({
      channelId: connection.channelId,
      workspaceName: gate.ctx.organizationName,
      connectedByName,
    }),
  );

  const outcome = describeTestPostOutcome({
    result,
    channelId: connection.channelId,
    channelLabel: channelLabel(connection),
  });

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
