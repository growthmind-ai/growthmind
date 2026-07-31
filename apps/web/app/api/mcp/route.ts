import type { ScopedDb } from "@growthmind/db";

import { createApiKeyMcpCredentials } from "@/lib/mcp/credentials";
import { createAbsentReadPort } from "@/lib/mcp/read-port";
import { handleMcpRequest, type McpServerDeps } from "@/lib/mcp/server";
import { getDb } from "@/lib/db";

// THE READ-ONLY MACHINE SURFACE, MOUNTED (O-009; `docs/architecture.md` §7).
//
// Three tools, all reads — `list_open_fixes`, `get_fix`, `get_finding`. `POST`
// calls one; `GET` lists them. There is no other verb here and no tool that
// writes: `report_shipped`, the draft contract's one write tool, is absent from
// `MCP_TOOLS` and asserted absent by name in
// `packages/shared/__tests__/mcp/tools.test.ts`.
//
// This file is the COMPOSITION ROOT and nothing else. Every decision lives in
// `@/lib/mcp`, and the handler there takes both of its effects as ports, so the
// whole surface is driven end to end through its real entry point in
// `apps/web/__tests__/mcp/` — the same split `worker/src/tasks/delivery-tick.ts`
// and `worker/src/index.ts` use. `resolveMcpDeps` is EXPORTED for one reason:
// the composition itself needs a test, or a correct credential source can sit
// beside a route still wired to the wrong one with the whole suite green
// (`apps/web/__tests__/mcp/wiring.test.ts`, ADD D-4).
//
// ===========================================================================
// WHAT THIS ENDPOINT DOES ON THIS INSTALLATION TODAY, AND THE TWO THINGS IT
// STILL CANNOT DO — BECAUSE A HALF-TRUE ENDPOINT IS WORSE THAN AN ABSENT ONE
// ===========================================================================
//
// WHAT WORKS NOW. A person mints a read credential in one command
// (`bun scripts/mint-api-key.ts`) and hands it to their coding agent. The agent
// presents it as `Authorization: Bearer gmak_…`, and this route authenticates
// it against a real organization-scoped credential store — the `api_keys` table
// (`docs/architecture.md` §6), resolved by `resolveApiKeyForRead`. Every read
// below is scoped to the organization that credential resolves to and never to
// anything the request said, and revoking a key takes effect on the very next
// request because nothing here caches. The public write-key family is still
// refused, and now EARLIER than before: at the format check, before any
// database access at all. `@/lib/mcp/credentials.ts` carries that argument in
// full.
//
// TWO SEPARATE THINGS ARE STILL MISSING FROM THIS BRANCH, AND NEITHER IS
// SOMETHING THIS ROUTE COULD INVENT.
//
// 1. NO TABLE RECORDS A FINDING OR A FIX. `packages/db/src/schema/` holds
//    finding signatures, dismissals and deliveries — the ledger and the
//    delivery record — and nothing a finding is stored in. So the read port is
//    the absent one: `list_open_fixes` answers with an empty list and a
//    truthful window, and both id lookups answer exactly as an unknown id does.
//    It does not crash, and it does not fabricate a row. See
//    `@/lib/mcp/read-port.ts`. The `findings` table is O-011's, and building a
//    second one here would be the worst outcome available.
//
// 2. THERE IS NO MCP WIRE PROTOCOL HERE — THIS IS PLAIN JSON OVER HTTP. A call
//    is `POST {"tool":…,"input":…}` and the catalogue is a plain `GET`. There
//    is no JSON-RPC 2.0 envelope, no `initialize` handshake, no session id and
//    no Streamable HTTP transport anywhere in this repository: zero occurrences
//    of `jsonrpc`, `tools/list`, `tools/call`, `modelcontextprotocol` or
//    `streamable` across `apps/`, `packages/`, `worker/` and `docs/`, and no
//    MCP SDK in any manifest. CONSEQUENCE, said plainly rather than left for
//    someone to discover: `claude mcp add` against this URL still fails at
//    `initialize`. What an agent CAN do today is reach it with curl, `fetch` or
//    a thin wrapper, call all three tools, and get truthful answers — including
//    truthfully empty. Do not claim more than that. The transport is O-012's.
//
// THE HONEST SUMMARY: O-009's definition of done — three tools exposed, every
// call organization-scoped and authenticated against a credential a person
// minted — is met and proven through the real exported handlers below. The
// cross-tenant identity guarantee, the fail-closed credential gate, the
// read-only shape and the graceful-absence answers all have named tests. What
// this surface does not yet have is data to answer with, or the wire protocol
// an MCP client speaks.
//
// WHAT UNBLOCKS EACH, one line of this file per gap:
//   - reads: a `findings` table (with fixes and evidence) plus an org-scoped
//     repository implementing `McpReadPort`; return it below instead of
//     `createAbsentReadPort`. Its one hard obligation is written in that file's
//     header — filter by organization in the SAME query as the id, so a foreign
//     row is `null` and not a slower `null`.
//   - the wire: a JSON-RPC 2.0 envelope over Streamable HTTP with an
//     `initialize` handshake, wrapping — not replacing — the handler this route
//     already calls.
//
// Nothing else in `@/lib/mcp` changes when either lands, because nothing else
// names a table or a transport.

// Always evaluated at request time: the answer depends on the credential the
// request carried, and a cached response on a tenant-scoped read is a
// cross-tenant leak with a nice name.
export const dynamic = "force-dynamic";

/**
 * The graceful-absence line, said once per process rather than once per
 * request. `worker/src/index.ts` says its equivalent once per tick for the same
 * reason: a silent empty answer is indistinguishable from a read that ran and
 * found nothing, and that is the one distinction worth keeping.
 */
const absentReads = createAbsentReadPort((message) => {
  console.warn(message);
});

/**
 * The wire, in one function — exported so it has a test (ADD D-4).
 *
 * The database is a DEFAULTED PARAMETER rather than a hard-coded call, so
 * `wiring.test.ts` can assert on the composition with a real `ScopedDb` and no
 * cast: `getDb()` is still what every request gets, because `POST` and `GET`
 * call this with no argument. It is resolved per request rather than at module
 * load, which is also why the wiring suite can install its handle into
 * `getDb()`'s process stash after importing this module.
 */
export function resolveMcpDeps(db: ScopedDb = getDb()): McpServerDeps {
  return {
    // The real credential store: an `api_keys` row a person minted, resolved
    // fail-closed. A public write key is refused before the database is even
    // reached — see `@/lib/mcp/credentials.ts`.
    credentials: createApiKeyMcpCredentials(db),
    // The absent read port, deliberately: the `findings` table is O-011's, and
    // its truthful-empty answers are this sprint's acceptance criterion rather
    // than a gap (gap 1 above).
    reads: absentReads,
  };
}

/** Calls one tool. The only verb that takes a body, and it still only reads. */
export async function POST(request: Request): Promise<Response> {
  return handleMcpRequest(request, resolveMcpDeps());
}

/** Lists the tools that exist. Authenticated like everything else here. */
export async function GET(request: Request): Promise<Response> {
  return handleMcpRequest(request, resolveMcpDeps());
}
