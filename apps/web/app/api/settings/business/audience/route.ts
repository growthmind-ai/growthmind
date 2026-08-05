// A person answering the rule we proposed for one of their `who_counts` sentences. Nothing
// narrows a denominator until this route has been called with "confirm".
import { createGrowthContextRepo, ensureProject } from "@growthmind/db";
import { settingsAudienceInputSchema } from "@growthmind/shared";

import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";
import { readRequestBody, refuseBody, requireTenant } from "@/lib/first-run/gate";
import { FACT_NOT_FOUND, refusalResponse } from "@/lib/first-run/refusals";

export const dynamic = "force-dynamic";

export const inputSchema = settingsAudienceInputSchema;

export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  const { projectId } = await ensureProject(deps.db, gate.ctx);

  const outcome = await createGrowthContextRepo(deps.db, gate.ctx).decideAudience({
    projectId,
    statement: parsed.data.statement,
    decision: parsed.data.decision,
    decidedAt: deps.now(),
  });

  // The sentence, or its proposal, moved under the browser — a re-read is the honest answer.
  if (outcome === "not_found") return refusalResponse(FACT_NOT_FOUND);

  return Response.json({ saved: true, confirmed: parsed.data.decision === "confirm" });
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
