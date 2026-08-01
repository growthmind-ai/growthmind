// POST /api/first-run/slack/connect — step three's front door (O-008, FR-O10,
// AD-16, AD-16a, AD-20).
//
// ###########################################################################
// # THE CREDENTIAL BECOMES AN ENVELOPE HERE AND NEVER COMES BACK OUT.
// #
// # `encryptSecret(botToken, key, slackCredentialAad(ctx))` produces
// # `v1.<keyId>.<iv>.<tag>.<ciphertext>`, and `keyIdOf(key)` stores the 8-hex
// # FINGERPRINT — never the key — so a rotation is a migratable event rather
// # than a silent identity fork (D12). The whole pattern is copied from
// # `project_connections` rather than re-derived.
// #
// # THE AAD HAS ONE PRODUCER AND IT TAKES A CONTEXT. `slackCredentialAad(ctx)`
// # binds the ciphertext to its owning organization, so a ciphertext lifted
// # from another organization's row FAILS AUTHENTICATION instead of decrypting
// # cross-tenant. Its second component is the literal scope rather than a
// # project id, because this connection is org-scoped and has no project — an
// # envelope sealed under a project-shaped AAD writes perfectly and fails at
// # delivery time, per customer, silently.
// #
// # AND NO METHOD RETURNS IT. `insertActive` answers with a summary built
// # field-by-field, never a spread of the row, so neither credential column
// # can ride out by accident. This handler returns that summary verbatim.
// ###########################################################################
//
// ── A SECOND ACTIVE CHANNEL IS REFUSED BY THE CONSTRAINT, NOT BY A READ ─────
//
// The partial unique index `slack_connections_active_org_uidx` is what settles
// it (EC-O6, D6): two members connecting at the same moment cannot both win,
// and the loser learns it from Postgres rather than from a prior read that
// another transaction has already invalidated. What reaches the customer is a
// plain sentence naming the one thing to do — never a `23505` and never a
// constraint name, which would be a bug wearing a database's clothes.
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

/** AD-16's row: `botToken`, `channelId`. AD-24: a pasted token is the shipped
 * mechanism this sprint — there is no Slack OAuth to redirect through. */
export const inputSchema = firstRunSlackConnectInputSchema;

/** Postgres' `unique_violation`. The partial index on `(organization_id) WHERE
 * is_active` is the only unique constraint an `insertActive` here can trip —
 * the primary key is a freshly generated uuid — so this class of refusal is
 * exactly the second-active-connection case. */
const UNIQUE_VIOLATION = "23505";

/** The index name, so the branch is on an identifier rather than on parsed
 * prose (D9). Kept as a fallback for drivers that surface the name only inside
 * the message. */
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

  // FR-O1, and the preamble is one story on all eight: the organization's
  // project exists by the time any step runs, so no route depends on another
  // having been called first. Read-first and settled by a constraint, so a
  // handler that has no use for the id — this one is org-scoped — still costs
  // one indexed read and never a second project.
  await ensureProject(deps.db, gate.ctx);

  // THE INHERITED GATE, FIRST AND UNCONDITIONALLY, and never re-derived. An
  // installation that cannot store an outside key safely makes no request and
  // writes no row — boot still works, this one operation does not.
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
      // ATTRIBUTION, so the test message can name who connected it (OQ-O6).
      // No read here or anywhere else ever narrows by it.
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
