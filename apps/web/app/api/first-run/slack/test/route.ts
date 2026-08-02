import { createSlackConnectionsRepo, ensureProject, findUserNameById } from "@growthmind/db";
import {
  describeTestPostOutcome,
  firstRunSlackTestInputSchema,
  POST_FAILURE_MESSAGES,
} from "@growthmind/shared";

import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";
import { readRequestBody, refuseBody, requireTenant } from "@/lib/first-run/gate";
import {
  CHANNEL_UNAVAILABLE,
  NO_CHANNEL_CONNECTED,
  refusalResponse,
} from "@/lib/first-run/refusals";
import { buildTestPostMessage } from "@/lib/first-run/slack-test-message";

export const dynamic = "force-dynamic";

export const inputSchema = firstRunSlackTestInputSchema;

export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  await ensureProject(deps.db, gate.ctx);

  const connection = await createSlackConnectionsRepo(deps.db, gate.ctx).getActiveForOrg();
  if (connection === null) {
    return refusalResponse(NO_CHANNEL_CONNECTED);
  }

  const poster = deps.poster ?? (await deps.posterFor?.(gate.ctx)) ?? null;
  if (poster === null) {
    return refusalResponse(CHANNEL_UNAVAILABLE);
  }

  const connectedByName =
    connection.connectedByUserId === null
      ? null
      : await findUserNameById(deps.db, connection.connectedByUserId);

  const result = await poster.post(
    buildTestPostMessage({
      channelId: connection.channelId,
      workspaceName: gate.ctx.organizationName,
      connectedByName,
    }),
  );

  const outcome = describeTestPostOutcome({ result, channelId: connection.channelId });

  return Response.json({
    ok: result.ok,

    code: result.ok ? null : result.code,
    message: result.ok ? null : POST_FAILURE_MESSAGES[result.code],

    sentence: outcome.sentence,
    retryable: outcome.retryable,
    marksStepDone: outcome.marksStepDone,
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
