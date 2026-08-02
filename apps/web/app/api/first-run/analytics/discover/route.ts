// POST /api/first-run/analytics/discover — the paste-a-key door (O-008
// follow-on, AD-1, AD-2, AD-3, AD-16, AD-16a).
//
// ###########################################################################
// # THIS ROUTE IS A DOOR, NOT A FLOW — the same division `analytics/connect`
// # draws one step later. `discoverProjects` (packages/adapters) is shipped
// # and has its own suite; the probe order, the walk that treats a 401 as
// # "ask the next origin", the ssrf gate on a self-hosted address, the 0/1/n
// # shapes and the `id`-not-`project_id` mapping all live there and are not
// # repeated here.
// #
// # WHAT THE DOOR OWES:
// #   1. The session is the ONLY tenancy input. The body has no `projectId`
// #      and the schema REFUSES one by name (AD-16, AD-16a) — before any
// #      probe leaves this process, so a refused request never spends a
// #      pasted key against somebody's analytics account.
// #   2. ONLY THE CODE CROSSES THE BOUNDARY. The refusal renders the sentence
// #      our own table holds for that code; the adapter's `message` is
// #      DROPPED rather than scrubbed, for the reason
// #      `connections.service.ts:154-165` states — a leaky upstream can echo a
// #      key back URL-encoded, JSON-escaped or truncated, three forms an
// #      exact-string scrub misses. A channel that never carries vendor text
// #      cannot carry a vendor stack trace to a founder either.
// #   3. The personal key is read off the parsed body, handed to the port,
// #      and appears in no response, no log line and no thrown value. Nothing
// #      here holds it after the call returns.
// #   4. Success is `{ host, projects[] }` — a LIST, at every arity. AD-3's
// #      one-project auto-select is the SCREEN's decision, so a route that
// #      collapsed n=1 into some other shape would sever it.
// ###########################################################################
//
// ── THE TWO THINGS THIS ROUTE DELIBERATELY DOES NOT DO ──────────────────────
//
// NO `ensureProject`. `connect` derives the project from the context because
// it is about to attach something to it. Discovery attaches nothing, reads
// nothing of ours and writes nothing: it asks a vendor which projects a pasted
// key can see. Minting a project row as a side effect of a read-only probe
// would leave a trace of a setup attempt that was abandoned at the next screen.
//
// NO NORMALISING OF `host`. A self-hosted address is forwarded exactly as the
// customer typed it; `checkHost` inside the adapter is the gate, and rewriting
// the value here would mean guarding a different string than the one that goes
// on to be requested.
import { CONNECT_REFUSAL_MESSAGES, firstRunAnalyticsDiscoverInputSchema } from "@growthmind/shared";

import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";
import { readRequestBody, refuseBody, requireTenant } from "@/lib/first-run/gate";

export const dynamic = "force-dynamic";

/** The schema's row: `personalApiKey`, and an OPTIONAL `host`. NO TENANCY KEY,
 * and `z.strictObject` so one sent anyway is refused rather than stripped. */
export const inputSchema = firstRunAnalyticsDiscoverInputSchema;

export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  // THE INSTALLATION GATE, BEFORE THE PROBE AND UNCONDITIONALLY — the same
  // gate `analytics/connect` opens with, for the same reason and with the same
  // sentence. The port is composed only where the credential key resolves
  // (`lib/first-run/deps.ts`), so its absence means this installation cannot
  // store an outside key safely. Discovering a project list for it would hand
  // the founder a choice whose only next step is a `misconfigured` refusal,
  // after their key had already been spent on a real request.
  if (deps.discoverProjects === undefined) {
    return Response.json(
      {
        ok: false,
        refusal: { code: "misconfigured", message: CONNECT_REFUSAL_MESSAGES.misconfigured },
      },
      { status: 400 },
    );
  }

  const result = await deps.discoverProjects({
    personalApiKey: parsed.data.personalApiKey,
    // `?? null`, AND THE TRANSLATION IS THIS LINE'S WHOLE JOB (D11). The schema
    // makes `host` optional because the common path never sends one — the field
    // is revealed only after every known region has refused (AD-2) — so
    // `parsed.data.host` is `undefined` there. The adapter branches on
    // `host === null` to choose between walking the known origins and making
    // one guarded request at a customer-supplied address, and `undefined` is
    // neither: it takes the customer-supplied branch and hands the host guard a
    // value that is not a host.
    host: parsed.data.host ?? null,
  });

  if (!result.ok) {
    // THE CODE AND OUR TABLE'S SENTENCE FOR IT. `result.failure.message` is not
    // read, not scrubbed and not forwarded — dropping is what makes the claim
    // structural instead of a promise about what the adapter happens to put in
    // that field today.
    //
    // A 4xx rather than a 5xx on every one of the five: each names something
    // the customer can go and change — the key, the address, the wait — and a
    // 500 would tell them the server is broken rather than that their key is.
    // 400 on all of them, as `analytics/connect` answers to all six of its own.
    return Response.json(
      {
        ok: false,
        refusal: {
          code: result.failure.code,
          message: CONNECT_REFUSAL_MESSAGES[result.failure.code],
        },
      },
      { status: 400 },
    );
  }

  // THE HOST THE PROBE SETTLED ON, because the connect call that follows writes
  // it straight through: what we probed and what gets stored are one string, so
  // the founder is never asked a region question they already answered by
  // pasting a key. And the LIST as the adapter mapped it — `sourceProjectId`
  // in particular is passed through verbatim rather than re-derived, because
  // the vendor's result carries two plausible id fields with different values
  // and choosing the wrong one is a silent read of somebody else's project.
  return Response.json({ ok: true, host: result.host, projects: result.projects });
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
