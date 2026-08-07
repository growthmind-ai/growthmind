import { createNotificationsRepo } from "@growthmind/db";
import { bellReadAllInputSchema } from "@growthmind/shared";

import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";
import { readRequestBody, refuseBody, requireTenant } from "@/lib/first-run/gate";

export const dynamic = "force-dynamic";

export const inputSchema = bellReadAllInputSchema;

// Advances the read watermark and nothing else: the badge is a separate fact, and
// conflating the two would clear a count the reader never saw (ADD D-5).
export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  await createNotificationsRepo(deps.db, gate.ctx).markAllRead();

  return Response.json({ readAll: true });
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
