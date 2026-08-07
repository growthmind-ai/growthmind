import { createNotificationsRepo } from "@growthmind/db";
import { bellOpenedInputSchema } from "@growthmind/shared";

import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";
import { readRequestBody, refuseBody, requireTenant } from "@/lib/first-run/gate";

export const dynamic = "force-dynamic";

export const inputSchema = bellOpenedInputSchema;

// Fired on open and again on close, so a row that arrived while the popover was open does
// not come back as a badge. The watermark only ever moves forward, which is what makes the
// second call free (ADD D-3, D-5).
export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  await createNotificationsRepo(deps.db, gate.ctx).stampOpened();

  return Response.json({ opened: true });
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
