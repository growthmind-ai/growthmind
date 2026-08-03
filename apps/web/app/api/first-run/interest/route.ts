import { createProviderInterestRepo } from "@growthmind/db";
import { firstRunInterestInputSchema, logger } from "@growthmind/shared";

import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";
import { readRequestBody, refuseBody, requireTenant } from "@/lib/first-run/gate";

export const dynamic = "force-dynamic";

export const inputSchema = firstRunInterestInputSchema;

export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  const { provider } = parsed.data;
  const { claimed } = await createProviderInterestRepo(deps.db, gate.ctx).note(
    provider,
    gate.ctx.userId,
  );

  // Fired only on the first insert for (org, provider), and a recorder failure
  // never touches the 200 — the row is already claimed (AD-6, D8).
  if (claimed) {
    try {
      deps.recordInterestNoted?.({
        organizationId: gate.ctx.organizationId,
        userId: gate.ctx.userId,
        provider,
      });
    } catch (error) {
      logger.error("first-run interest: the noted event was not recorded", {
        organizationId: gate.ctx.organizationId,
        provider,
        error,
      });
    }
  }

  return Response.json({ noted: true });
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
