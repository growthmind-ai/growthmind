import {
  createFindingsRepo,
  createFirstRunStatusService,
  describeDriverError,
  ensureProject,
} from "@growthmind/db";
import type { ScopedDb } from "@growthmind/db";
import { firstRunStatusInputSchema, logger } from "@growthmind/shared";
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
    // `describeDriverError`, never the caught value and never `describeError`: a failed
    // query's own message IS the statement and its bound parameters, so both of those
    // write tenancy ids into the log. Only the driver's cause names no value.
    logger.error("onboarding status: a finding row exists for this project but cannot be read", {
      organizationId: ctx.organizationId,
      projectId,
      reason: describeDriverError(error),
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
