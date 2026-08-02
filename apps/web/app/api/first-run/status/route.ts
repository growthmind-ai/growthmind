import { createFindingsRepo, createFirstRunStatusService, ensureProject } from "@growthmind/db";
import type { ScopedDb } from "@growthmind/db";
import { describeError, firstRunStatusInputSchema } from "@growthmind/shared";
import type { TenantContext } from "@growthmind/shared";

import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";
import { readRequestBody, refuseBody, requireTenant } from "@/lib/first-run/gate";
import { buildFirstRunStatus } from "@/lib/first-run/status";

export const dynamic = "force-dynamic";

export const inputSchema = firstRunStatusInputSchema;

async function findingRowExists(
  db: ScopedDb,
  ctx: TenantContext,
  projectId: string,
): Promise<boolean> {
  try {
    const [row] = await createFindingsRepo(db, ctx).listForProject(projectId, { limit: 1 });
    return row !== undefined;
  } catch (error) {
    // `describeError` RATHER THAN THE CAUGHT VALUE. This was the only
    // unscrubbed error sink on the surface — every other log here prints reason
    // codes — and the shapes that reach it are not all Zod's. A `pg` driver
    // error carries `.query` and `.parameters`, so logging the object whole
    // writes the statement and its bound values into the log, and the values
    // bound on this surface are tenancy ids and whatever a row happened to
    // hold. The message is what a person debugging needs; the rest is the
    // row's own neighbourhood.
    console.error("onboarding status: a finding row exists for this project but cannot be read", {
      organizationId: ctx.organizationId,
      projectId,
      reason: describeError(error),
    });
    return true;
  }
}

export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  const { projectId } = await ensureProject(deps.db, gate.ctx);

  const facts = await createFirstRunStatusService(deps.db, gate.ctx).read(projectId);

  const findingUnavailable =
    facts.finding === null && (await findingRowExists(deps.db, gate.ctx, projectId));

  return Response.json(
    await buildFirstRunStatus({
      db: deps.db,
      ctx: gate.ctx,
      projectId,
      facts,
      findingUnavailable,
    }),
  );
}

export async function GET(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
