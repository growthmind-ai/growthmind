// No `ensureProject`: discovery writes nothing, and minting a row for an
// abandoned probe leaves a trace of a setup nobody finished. `host` is NOT
// normalised — the adapter's `checkHost` must guard the same string that gets
// requested. The vendor's own message is DROPPED, not scrubbed: a leaky
// upstream can echo a key back encoded, escaped or truncated.
import { CONNECT_REFUSAL_MESSAGES, firstRunAnalyticsDiscoverInputSchema } from "@growthmind/shared";

import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";
import { readRequestBody, refuseBody, requireTenant } from "@/lib/first-run/gate";

export const dynamic = "force-dynamic";

export const inputSchema = firstRunAnalyticsDiscoverInputSchema;

export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

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
    // `?? null` is load-bearing: `host === null` walks the known origins, `undefined` does not.
    host: parsed.data.host ?? null,
  });

  if (!result.ok) {
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

  return Response.json({ ok: true, host: result.host, projects: result.projects });
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
