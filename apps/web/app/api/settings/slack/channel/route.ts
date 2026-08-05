// MOVES a delivery address the first-run route only ever fills — a separate route because
// it is a different write: filling a sentinel forks nothing, moving a chosen channel forks
// every recorded delivery identity keyed on `(organization_id, finding_id, channel_id)`.
// The cutover stamped in the same statement is what makes it safe (D12).
import { createSlackConnectionsRepo, ensureProject, isDeliveryTarget } from "@growthmind/db";
import {
  channelLabel,
  SETTINGS_CHANNEL_MOVED_TEMPLATE,
  SETTINGS_CHANNEL_UNCHANGED_LINE,
  settingsSlackChannelInputSchema,
} from "@growthmind/shared";

import {
  resolveChannelsFor,
  resolveFirstRunDeps,
  type FirstRunRouteDeps,
} from "@/lib/first-run/deps";
import { readRequestBody, refuseBody, requireTenant } from "@/lib/first-run/gate";
import {
  CHANNEL_MOVE_LOST,
  CHANNEL_NOT_LISTED,
  LISTING_REFUSALS,
  NO_CHANNEL_CHOSEN,
  NO_WORKSPACE_CONNECTED,
  refusalResponse,
} from "@/lib/first-run/refusals";

export const dynamic = "force-dynamic";

export const inputSchema = settingsSlackChannelInputSchema;

export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  await ensureProject(deps.db, gate.ctx);

  const connections = createSlackConnectionsRepo(deps.db, gate.ctx);
  const existing = await connections.getActiveForOrg();

  if (existing === null) {
    return refusalResponse(NO_WORKSPACE_CONNECTED);
  }

  // Nothing to move: with no address the picker belongs to the fill route, not this one.
  if (!isDeliveryTarget(existing)) {
    return refusalResponse(NO_CHANNEL_CHOSEN);
  }

  // A 200, not a refusal — and no cutover, which would suppress every undelivered finding.
  if (existing.channelId === parsed.data.channelId) {
    return Response.json({
      moved: false,
      channelId: existing.channelId,
      sentence: SETTINGS_CHANNEL_UNCHANGED_LINE,
    });
  }

  // Proved against the live list before stamping, as the fill route does: a picker left
  // open on an archived channel stamps an address whose failure surfaces later as silence.
  const listing = await resolveChannelsFor(deps)(gate.ctx);
  if (!listing.ok) {
    return refusalResponse(LISTING_REFUSALS[listing.code]);
  }

  const chosen = listing.channels.find((channel) => channel.id === parsed.data.channelId);
  if (chosen === undefined) {
    return refusalResponse(CHANNEL_NOT_LISTED);
  }

  const moved = await connections.repointChannel({
    channelId: parsed.data.channelId,
    channelName: chosen.name,
    cutoverAt: deps.now(),
  });

  // The read said there was an address, so losing here is another member's concurrent move.
  if (moved === null) {
    return refusalResponse(CHANNEL_MOVE_LOST);
  }

  return Response.json({
    moved: true,
    channelId: moved.channelId,
    sentence: SETTINGS_CHANNEL_MOVED_TEMPLATE.replaceAll(
      "{channel}",
      channelLabel(moved) ?? parsed.data.channelId,
    ),
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
