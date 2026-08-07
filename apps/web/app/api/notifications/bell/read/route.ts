import { createNotificationsRepo } from "@growthmind/db";
import { bellReadInputSchema } from "@growthmind/shared";

import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";
import { readRequestBody, refuseBody, requireTenant } from "@/lib/first-run/gate";

export const dynamic = "force-dynamic";

// The notification id is the only key: the person and the organization come from the
// session, so another org's row can be named and still writes nothing (D7).
export const inputSchema = bellReadInputSchema;

export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  const read = await createNotificationsRepo(deps.db, gate.ctx).markRead(
    parsed.data.notificationId,
  );

  // Unknown and not-ours get the same answer: nothing about another org's rows is
  // knowable from here, including whether one exists (D7).
  if (!read) {
    return Response.json({ read: false }, { status: 404 });
  }

  return Response.json({ read: true });
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
