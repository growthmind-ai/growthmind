import { POSTHOG_SOURCE_KIND } from "@growthmind/adapters";
import { ensureProject } from "@growthmind/db";
import { CONNECT_REFUSAL_MESSAGES, firstRunAnalyticsConnectInputSchema } from "@growthmind/shared";

import { firstRunConnectionsService } from "@/lib/first-run/connections";
import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";
import { readRequestBody, refuseBody, requireTenant } from "@/lib/first-run/gate";

export const dynamic = "force-dynamic";

export const inputSchema = firstRunAnalyticsConnectInputSchema;

export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  const { projectId } = await ensureProject(deps.db, gate.ctx);

  if (deps.createSource === undefined) {
    return Response.json(
      {
        ok: false,
        refusal: { code: "misconfigured", message: CONNECT_REFUSAL_MESSAGES.misconfigured },
      },
      { status: 400 },
    );
  }

  const service = firstRunConnectionsService(deps.db, gate.ctx, deps);

  const result = await service.connect({
    projectId,
    sourceKind: POSTHOG_SOURCE_KIND,
    host: parsed.data.host,
    sourceProjectId: parsed.data.sourceProjectId,
    personalApiKey: parsed.data.personalApiKey,
  });

  if (!result.ok) {
    return Response.json({ ok: false, refusal: result.refusal }, { status: 400 });
  }

  return Response.json({
    ok: true,
    state: await service.getState(projectId),
    firstPullEventsSeen: result.firstPullEventsSeen,
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
