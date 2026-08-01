import type { ScopedDb } from "@growthmind/db";

import { createApiKeyMcpCredentials } from "@/lib/mcp/credentials";
import { createAbsentReadPort } from "@/lib/mcp/read-port";
import { handleMcpRequest, type McpServerDeps } from "@/lib/mcp/server";
import { getDb } from "@/lib/db";

// The read-only machine surface's composition root: three tools, all reads, served as
// JSON-RPC over one POST. Every decision lives in `@/lib/mcp`; this file only wires in
// the real credential store and the deliberately absent read port. If `2026-07-28`
// looks missing from the transport's negotiation list, that absence is deliberate and
// must not be "fixed": see `@/lib/mcp/wire-constants.ts`.
// Design rationale: docs/decisions/0007-mcp-route-surface.md

// Always evaluated at request time: the answer depends on the credential the request
// carried, and a cached response on a tenant-scoped read is a cross-tenant leak with a
// nice name.
export const dynamic = "force-dynamic";

/**
 * The graceful-absence line, said once per process rather than once per request.
 * `worker/src/index.ts` says its equivalent once per tick for the same reason: a silent
 * empty answer is indistinguishable from a read that ran and found nothing, and that is
 * the one distinction worth keeping.
 */
const absentReads = createAbsentReadPort((message) => {
  console.warn(message);
});

/**
 * The wire, in one function. Exported so it has a test.
 *
 * The database is a defaulted parameter rather than a hard-coded call, so
 * `wiring.test.ts` can assert on the composition with a real `ScopedDb` and no cast:
 * `getDb` is still what every request gets, because `POST` and `GET` call this with
 * no argument. It is resolved per request rather than at module load, which is also why
 * the wiring suite can install its handle into `getDb`'s process stash after
 * importing this module.
 */
export function resolveMcpDeps(db: ScopedDb = getDb()): McpServerDeps {
  return {
    // The real credential store: an `api_keys` row a person minted, resolved
    // fail-closed. A public write key is refused before the database is even reached,
    // see `@/lib/mcp/credentials.ts`.
    credentials: createApiKeyMcpCredentials(db),
    // The absent read port, deliberately: the `findings` table is another sprint's, and
    // its truthful-empty answers are an acceptance criterion rather than a gap (see
    // docs/decisions/0007-mcp-route-surface.md).
    reads: absentReads,
  };
}

/** The whole protocol, on one verb: a single JSON-RPC message in, one answer out.
 * `tools/list` names what exists and `tools/call` runs one, and every one of them only
 * reads. */
export async function POST(request: Request): Promise<Response> {
  return handleMcpRequest(request, resolveMcpDeps());
}

/**
 * The verb this surface does not answer, answered anyway.
 *
 * Exported rather than left unmounted, on purpose. The catalogue moved onto the wire
 * protocol, so a `GET` has nothing left to serve, but a real client opens a speculative
 * one during every successful handshake, and an agent that tries it deserves a sentence
 * saying what to send instead. `handleMcpRequest` answers 405 with exactly that; Next's
 * own bodiless 405, which is what the unmounted verbs get, would not.
 */
export async function GET(request: Request): Promise<Response> {
  return handleMcpRequest(request, resolveMcpDeps());
}
