import {
  createSlackConnectionsRepo,
  ensureProject,
  SlackConnectionWriteError,
  slackCredentialAad,
} from "@growthmind/db";
import {
  CONNECT_REFUSAL_MESSAGES,
  encryptSecret,
  firstRunSlackConnectInputSchema,
  keyIdOf,
  parseServerEnv,
  resolveCredentialKey,
} from "@growthmind/shared";

import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";
import { readRequestBody, refuseBody, requireTenant } from "@/lib/first-run/gate";
import { refusalResponse, SECOND_CHANNEL } from "@/lib/first-run/refusals";

export const dynamic = "force-dynamic";

export const inputSchema = firstRunSlackConnectInputSchema;

const UNIQUE_VIOLATION = "23505";

const ACTIVE_ORG_INDEX = "slack_connections_active_org_uidx";

function isSecondActiveConnection(error: SlackConnectionWriteError): boolean {
  return (
    error.constraint === ACTIVE_ORG_INDEX ||
    error.code === UNIQUE_VIOLATION ||
    error.message.includes(ACTIVE_ORG_INDEX)
  );
}

export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  await ensureProject(deps.db, gate.ctx);

  const resolution = deps.credentialKey ?? resolveCredentialKey(parseServerEnv(process.env));
  if (!resolution.ok) {
    return Response.json(
      {
        ok: false,
        refusal: { code: "misconfigured", message: CONNECT_REFUSAL_MESSAGES.misconfigured },
      },
      { status: 400 },
    );
  }

  try {
    const connection = await createSlackConnectionsRepo(deps.db, gate.ctx).insertActive({
      channelId: parsed.data.channelId,
      credentialCiphertext: encryptSecret(
        parsed.data.botToken,
        resolution.key,
        slackCredentialAad(gate.ctx),
      ),
      credentialKeyId: keyIdOf(resolution.key),

      connectedByUserId: gate.ctx.userId,
      connectedAt: deps.now(),
    });

    return Response.json({ ok: true, connection });
  } catch (error) {
    if (error instanceof SlackConnectionWriteError && isSecondActiveConnection(error)) {
      return refusalResponse(SECOND_CHANNEL);
    }
    throw error;
  }
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
