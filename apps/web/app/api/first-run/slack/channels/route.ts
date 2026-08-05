// AD-20: this route is handed a per-org listing port and never opens the
// credential itself — `openCredentialForOrg` belongs to the delivery
// composition root, and no route, page or service may call it. A response
// cannot leak what the handler never received.
// AD-7 decided, not omitted: fetched live and stored nowhere, so a channel made a minute ago is pickable.
import { firstRunSlackChannelsInputSchema } from "@growthmind/shared";

import {
  resolveChannelsFor,
  resolveFirstRunDeps,
  type FirstRunRouteDeps,
} from "@/lib/first-run/deps";
import { readRequestBody, refuseBody, requireTenant } from "@/lib/first-run/gate";
import { LISTING_REFUSALS, refusalResponse } from "@/lib/first-run/refusals";

export const dynamic = "force-dynamic";

export const inputSchema = firstRunSlackChannelsInputSchema;

export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  const listing = await resolveChannelsFor(deps)(gate.ctx);

  if (!listing.ok) {
    return refusalResponse(LISTING_REFUSALS[listing.code]);
  }

  return Response.json({ ok: true, channels: listing.channels });
}

export async function GET(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
