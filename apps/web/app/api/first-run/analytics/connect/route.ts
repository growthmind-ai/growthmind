// POST /api/first-run/analytics/connect — step two's front door (O-008,
// FR-O5, FR-O6, AD-16, AD-16a).
//
// ###########################################################################
// # THIS ROUTE IS A DOOR, NOT A FLOW. `createConnectionsService` is shipped
// # and has its own suite; the whole attach sequence — the credential gate,
// # the validation, the encryption, the constraint-settled second-source
// # refusal, the inline first pull — lives there and is not repeated here.
// #
// # WHAT THE DOOR OWES:
// #   1. The project comes from the SESSION. The body has no `projectId` and
// #      the schema REFUSES one (AD-16, AD-16a) — before any query is made and
// #      before the source factory is ever constructed.
// #   2. ONLY THE CODE CROSSES THE BOUNDARY. The refusal's sentence comes from
// #      the shipped table; the source's own `message` is DROPPED rather than
// #      scrubbed, for the reason `connections.service.ts:154-165` states — a
// #      leaky upstream can echo a key back URL-encoded, JSON-escaped or
// #      truncated, three forms an exact-string scrub misses. A vendor stack
// #      trace cannot reach a customer through a channel that never carries
// #      vendor text.
// #   3. The personal key never appears in a response, a log, or on a thrown
// #      value. It is read off the parsed body, handed to the service, and
// #      nothing here holds it afterwards.
// ###########################################################################
//
// ── THE VENDOR IS NAMED ONCE, AND IT IS NOT ON THE WIRE ─────────────────────
//
// `sourceKind` is supplied here from the adapter's own exported constant, not
// accepted from the body. A client that could choose the adapter would be
// choosing which vendor's API we call on the customer's behalf.
import { POSTHOG_SOURCE_KIND } from "@growthmind/adapters";
import { ensureProject } from "@growthmind/db";
import { CONNECT_REFUSAL_MESSAGES, firstRunAnalyticsConnectInputSchema } from "@growthmind/shared";

import { firstRunConnectionsService } from "@/lib/first-run/connections";
import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";
import { readRequestBody, refuseBody, requireTenant } from "@/lib/first-run/gate";

export const dynamic = "force-dynamic";

/** AD-16's row: `host`, `sourceProjectId`, `personalApiKey`. NO TENANCY KEY,
 * and `z.strictObject` so one sent anyway is refused rather than stripped. */
export const inputSchema = firstRunAnalyticsConnectInputSchema;

export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  const { projectId } = await ensureProject(deps.db, gate.ctx);

  // THE INSTALLATION GATE, FIRST AND UNCONDITIONALLY. The service checks the
  // credential resolution itself and refuses `misconfigured` with no request
  // made and no row written; this branch is the same answer for the case where
  // the composition could not build a source factory either, which happens for
  // exactly the same reason — the identity key and the encryption key are the
  // same material.
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
    // FROM THE CONTEXT, NEVER FROM THE BODY. This is the line AD-16 exists for.
    projectId,
    sourceKind: POSTHOG_SOURCE_KIND,
    host: parsed.data.host,
    sourceProjectId: parsed.data.sourceProjectId,
    personalApiKey: parsed.data.personalApiKey,
  });

  if (!result.ok) {
    // The CODE and the table's SENTENCE, and nothing the source said. A 4xx
    // rather than a 5xx on every one of the six: each names something the
    // customer can go and change, and a 500 would tell them the server is
    // broken rather than that their key, project number or address is.
    return Response.json({ ok: false, refusal: result.refusal }, { status: 400 });
  }

  // The connection summary carries no credential column by construction, and
  // the state is re-read from persisted rows so the answer a customer gets is
  // the one a reload would give them.
  return Response.json({
    ok: true,
    state: await service.getState(projectId),
    firstPullEventsSeen: result.firstPullEventsSeen,
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
