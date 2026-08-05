// A person adding, correcting or removing a business fact. The only writer that produces a
// fact the next read of the site will not overwrite, and the only one that may say a person
// said it.
import { admitStatement } from "@growthmind/core";
import { createGrowthContextRepo, ensureProject } from "@growthmind/db";
import { settingsBusinessFactInputSchema } from "@growthmind/shared";

import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";
import { readRequestBody, refuseBody, requireTenant } from "@/lib/first-run/gate";
import {
  FACT_KIND_FULL,
  FACT_NOT_ADMITTED,
  FACT_NOT_FOUND,
  refusalResponse,
} from "@/lib/first-run/refusals";

export const dynamic = "force-dynamic";

export const inputSchema = settingsBusinessFactInputSchema;

export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  // §5 applies to a person's own words too. The table describes segments and rules whoever
  // wrote the sentence, and a typed name is as much a name as a read one.
  if (parsed.data.statement !== null && !admitStatement(parsed.data.statement).admitted) {
    return refusalResponse(FACT_NOT_ADMITTED);
  }

  const { projectId } = await ensureProject(deps.db, gate.ctx);

  const outcome = await createGrowthContextRepo(deps.db, gate.ctx).stateFact({
    projectId,
    kind: parsed.data.kind,
    was: parsed.data.was,
    statement: parsed.data.statement,
    statedAt: deps.now(),
  });

  // The row moved under the browser — a re-read is the honest answer, not a silent write
  // against a fact that is no longer there.
  if (outcome === "not_found") return refusalResponse(FACT_NOT_FOUND);
  if (outcome === "full") return refusalResponse(FACT_KIND_FULL);

  return Response.json({ saved: true, removed: parsed.data.statement === null });
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
