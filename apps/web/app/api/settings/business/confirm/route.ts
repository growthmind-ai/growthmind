// A person standing behind one sentence the site read said of their business. No free
// text crosses here: the statement must equal a fact already in the table, so there is
// nothing to admit and nothing to research — one click, one confirmation (AD-1, AD-3).
import { createGrowthContextRepo, ensureProject } from "@growthmind/db";
import { settingsBusinessConfirmInputSchema } from "@growthmind/shared";

import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";
import { readRequestBody, refuseBody, requireTenant } from "@/lib/first-run/gate";
import { FACT_NOT_FOUND, refusalResponse } from "@/lib/first-run/refusals";

export const dynamic = "force-dynamic";

export const inputSchema = settingsBusinessConfirmInputSchema;

export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  // Signed-out answers before the body is even read: an unparseable body from an
  // unauthenticated caller is a 401, never a 400 (D7 route half).
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  const { projectId } = await ensureProject(deps.db, gate.ctx);

  const outcome = await createGrowthContextRepo(deps.db, gate.ctx).confirmFact({
    projectId,
    kind: parsed.data.kind,
    statement: parsed.data.statement,
    confirmedAt: deps.now(),
    // From the credential, never the payload: the schema has nowhere to name an actor.
    confirmedBy: gate.ctx.userId,
  });

  // The row moved under the browser — a re-read is the honest answer, not a fabricated
  // success against a sentence that is no longer there.
  if (outcome === "not_found") return refusalResponse(FACT_NOT_FOUND);

  // `already_confirmed` is still saved to the person who clicked: their click changed
  // nothing only because it had already stuck (D3).
  return Response.json({ saved: true });
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
