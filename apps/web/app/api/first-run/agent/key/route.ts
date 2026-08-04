import { createApiKeysRepo } from "@growthmind/db";
import {
  apiKeyNameFor,
  firstRunAgentMintInputSchema,
  logger,
  providerDisplayName,
} from "@growthmind/shared";

import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";
import { readRequestBody, refuseBody, requireTenant } from "@/lib/first-run/gate";

export const dynamic = "force-dynamic";

export const inputSchema = firstRunAgentMintInputSchema;

export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  const { provider } = parsed.data;

  const minted = await createApiKeysRepo(deps.db, gate.ctx).mint({
    name: apiKeyNameFor({
      requested: null,
      label: providerDisplayName(provider),
      now: deps.now(),
    }),
  });

  // D-14, D8: the key is already stored, so a recorder failure may not touch the
  // 200 — and the raw material is in no argument here and in no log field.
  try {
    deps.recordAgentKeyMinted?.({ organizationId: gate.ctx.organizationId, provider });
  } catch (error) {
    logger.error("first-run agent key: the mint event was not recorded", {
      organizationId: gate.ctx.organizationId,
      provider,
      error,
    });
  }

  // The raw key and nothing else: no id, prefix, name or timestamp (AC-3). It is
  // never readable again — no other response in the product carries it.
  return Response.json({ key: minted.raw });
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
