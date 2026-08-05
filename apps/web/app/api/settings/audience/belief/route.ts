// A person disagreeing with what we read off their site. The only writer that produces a
// belief the next read will not overwrite, and the only one that may say a person said it.
import { admitIcpStatement } from "@growthmind/core";
import { createGrowthContextRepo, ensureProject } from "@growthmind/db";
import { settingsBeliefInputSchema } from "@growthmind/shared";

import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";
import { readRequestBody, refuseBody, requireTenant } from "@/lib/first-run/gate";
import { BELIEF_NOT_ADMITTED, BELIEF_NOT_FOUND, refusalResponse } from "@/lib/first-run/refusals";

export const dynamic = "force-dynamic";

export const inputSchema = settingsBeliefInputSchema;

export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  // §5 applies to a person's own words too. The table describes segments whoever wrote the
  // sentence, and a typed name is as much a name as a read one.
  if (parsed.data.statement !== null && !admitIcpStatement(parsed.data.statement).admitted) {
    return refusalResponse(BELIEF_NOT_ADMITTED);
  }

  const { projectId } = await ensureProject(deps.db, gate.ctx);

  const corrected = await createGrowthContextRepo(deps.db, gate.ctx).correctBelief({
    projectId,
    kind: parsed.data.kind,
    was: parsed.data.was,
    statement: parsed.data.statement,
    statedAt: deps.now(),
  });

  // The row moved under the browser — a re-read is the honest answer, not a silent write
  // against a belief that is no longer there.
  if (!corrected) {
    return refusalResponse(BELIEF_NOT_FOUND);
  }

  return Response.json({ saved: true, removed: parsed.data.statement === null });
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
