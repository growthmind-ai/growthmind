import {
  createApiKeysRepo,
  createSlackConnectionsRepo,
  findUserNameById,
  isDeliveryTarget,
} from "@growthmind/db";
import {
  firstRunAgentRevokeInputSchema,
  logger,
  memberUserId,
  type TenantContext,
} from "@growthmind/shared";

import { buildAgentRevokeAnnouncement } from "@/lib/first-run/agent-revoke-announcement";
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

  const anyRevoked = await createApiKeysRepo(deps.db, gate.ctx).revokeEveryLive();

  // Only on the real transition: a retried call (D4) preserves the first call's
  // timestamp and must not re-announce what the org already heard.
  if (anyRevoked) {
    await announceRevocation(deps, gate.ctx);
  }

  // A 200 whether or not anything was live: revoking nothing is not a refusal,
  // and the second call keeps the first revocation's stamp (D4).
  return Response.json({ revoked: true });
}

// B-055: the confirm dialog is honest with the person pressing about the
// workspace-wide blast radius — nothing told the rest of the org. Best-effort
// and D8-isolated: a missing Slack connection or a failed post never turns a
// successful revoke into an error, and self-hosted orgs with no Slack channel
// simply get no announcement, same as the connection-test path degrades.
async function announceRevocation(deps: FirstRunRouteDeps, ctx: TenantContext): Promise<void> {
  try {
    const connection = await createSlackConnectionsRepo(deps.db, ctx).getActiveForOrg();
    if (connection === null || !isDeliveryTarget(connection)) return;

    const poster = deps.poster ?? (await deps.posterFor?.(ctx)) ?? null;
    if (poster === null) return;

    const revokedByUserId = memberUserId(ctx);
    const revokedByName =
      revokedByUserId === null ? null : await findUserNameById(deps.db, revokedByUserId);

    await poster.post(
      buildAgentRevokeAnnouncement({
        channelId: connection.channelId,
        workspaceName: ctx.organizationName,
        revokedByName,
      }),
    );
  } catch (error) {
    logger.error("agent revoke: could not announce the revocation to the org's Slack channel", {
      organizationId: ctx.organizationId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
