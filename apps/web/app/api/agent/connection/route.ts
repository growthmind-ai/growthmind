// First contact is stamped outside the browser, so a page showing the connection has to
// ask again to notice it. The first-run surface asks its own status route; every surface
// after setup asks this one.
import { createApiKeysRepo, describeDriverError } from "@growthmind/db";
import { logger, toAgentConnection } from "@growthmind/shared";

import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";
import { requireTenant } from "@/lib/first-run/gate";
import { refusalResponse, type FirstRunGateRefusal } from "@/lib/first-run/refusals";

export const dynamic = "force-dynamic";

export const CONNECTION_UNREADABLE: FirstRunGateRefusal = Object.freeze({
  code: "connection_unreadable",
  status: 503,
  message:
    "We could not check whether your assistant has called yet. Nothing has changed; try again in a moment.",
});

export async function handle(_request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  try {
    const use = await createApiKeysRepo(deps.db, gate.ctx).liveKeyUse();
    return Response.json({ connection: toAgentConnection(use) });
  } catch (error) {
    // The declared fail direction: a refusal, never a connection. An unreadable row
    // answering `none` would tell an org that is already connected to mint again.
    logger.error("agent connection: whether a key has been used could not be read", {
      organizationId: gate.ctx.organizationId,
      reason: describeDriverError(error),
    });
    return refusalResponse(CONNECTION_UNREADABLE);
  }
}

export async function GET(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
