import { ensureProject } from "@growthmind/db";
import {
  CONNECTION_STATE_MESSAGES,
  firstRunAnalyticsDisconnectInputSchema,
} from "@growthmind/shared";

import { firstRunConnectionsService } from "@/lib/first-run/connections";
import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";
import { readRequestBody, refuseBody, requireTenant } from "@/lib/first-run/gate";

export const dynamic = "force-dynamic";

export const inputSchema = firstRunAnalyticsDisconnectInputSchema;

export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  const { projectId } = await ensureProject(deps.db, gate.ctx);

  const state = await firstRunConnectionsService(deps.db, gate.ctx, deps).disconnect(projectId);

  return Response.json({ state, message: CONNECTION_STATE_MESSAGES[state.status] });
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
