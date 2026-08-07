import { createApiKeysRepo } from "@growthmind/db";
import { firstRunAgentRevokeInputSchema } from "@growthmind/shared";

import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";
import { readRequestBody, refuseBody, requireTenant } from "@/lib/first-run/gate";

export const dynamic = "force-dynamic";

// Zero keys, strict: a client-supplied key id is refused by a signature with
// nowhere to put one, never by a check a later change could remove (D-5, D7).
export const inputSchema = firstRunAgentRevokeInputSchema;

export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  // The announcement is the repository's now (O-051): the revoke and the notification of it
  // commit together, so the org hears about it whether the transition came from here or
  // from anywhere else that revokes. B-055's disclosure survives; its bespoke path does not.
  await createApiKeysRepo(deps.db, gate.ctx).revokeEveryLive();

  // A 200 whether or not anything was live: revoking nothing is not a refusal,
  // and the second call keeps the first revocation's stamp (D4).
  return Response.json({ revoked: true });
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
