import { createFirstRunStatusService, ensureProject } from "@growthmind/db";
import { firstRunStatusInputSchema } from "@growthmind/shared";

import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";
import { readRequestBody, refuseBody, requireTenant } from "@/lib/first-run/gate";
import { buildFirstRunStatus } from "@/lib/first-run/status";

export const dynamic = "force-dynamic";

export const inputSchema = firstRunStatusInputSchema;

export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  const { projectId } = await ensureProject(deps.db, gate.ctx);

  // ONE read for all three finding facts. This route ran a bounded finding read of its
  // own to decide `findingUnavailable`, and the status builder a third to correlate the
  // delivery — so the card, the fault sentence and the delivery line could each describe
  // a different row (B-038). The service is now the only reader.
  const facts = await createFirstRunStatusService(deps.db, gate.ctx).read(projectId);

  return Response.json(await buildFirstRunStatus({ db: deps.db, ctx: gate.ctx, projectId, facts }));
}

export async function GET(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
