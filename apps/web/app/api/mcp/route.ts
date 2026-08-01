import type { ScopedDb } from "@growthmind/db";

import { createApiKeyMcpCredentials } from "@/lib/mcp/credentials";
import { createAbsentReadPort } from "@/lib/mcp/read-port";
import { handleMcpRequest, type McpServerDeps } from "@/lib/mcp/server";
import { getDb } from "@/lib/db";

// THE READ-ONLY MACHINE SURFACE, MOUNTED (O-009, O-013; `docs/architecture.md`
// §7).
//
// Three tools, all reads — `list_open_fixes`, `get_fix`, `get_finding`. A
// `POST` carrying a JSON-RPC message is the only verb; `tools/list` names them
// and `tools/call` runs one. There is no other verb here and no tool that
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
// WHAT THIS ENDPOINT DOES ON THIS INSTALLATION TODAY, AND THE ONE THING IT
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
// ONE THING IS STILL MISSING FROM THIS BRANCH, AND IT IS NOT SOMETHING THIS
// ROUTE COULD INVENT.
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
// ===========================================================================
// THIS SURFACE SPEAKS MCP, AND IT SERVES BOTH PROTOCOL ERAS FROM ONE HANDLER
// ===========================================================================
//
// A call is a JSON-RPC 2.0 message on the `POST`, and the catalogue arrives as
// `tools/list` on the same verb — `GET` is a 405 with a sentence saying so
// (`@/lib/mcp/refusals.ts`). `claude mcp add --transport http` against this URL
// connects: a stock client, constructed with no options at all, negotiates the
// LEGACY floor `2025-11-25` through the `initialize` handshake and lists three
// tools. The SAME handler also serves the MODERN `2026-07-28` era, which it
// advertises through `server/discover` to a client that asks for it. Neither
// leg is configuration; the transport serves both and offers no switch that
// turns either off.
//
// ⚠️ THE RECONCILIATION, BECAUSE IT IS THE TRAP THE NEXT READER HITS.
// `2026-07-28` is ABSENT from the transport package's own
// `SUPPORTED_PROTOCOL_VERSIONS`, and that absence is correct and asserted ON
// PURPOSE. That list is the LEGACY-ERA NEGOTIATION LIST, and an era that drops
// the `initialize` handshake has nothing to negotiate — it advertises itself by
// discovery instead. It is not a gap and it must not be "fixed" by editing the
// list. `@/lib/mcp/wire-constants.ts` carries the same warning beside the
// constant, and a real client proves the era is served by refusing to connect
// any other way.
//
// AN HONEST SHORTFALL, RECORDED RATHER THAN ENGINEERED AROUND. Our 401 is
// produced before the transport is anywhere in the call stack, so its bytes are
// identical on both eras. But on the MODERN leg's `connect()` ONLY, the
// client's own version-negotiation probe REPLACES our sentence with its own
// ("Version negotiation failed: the server requires authorization (HTTP 401)"),
// so "errors instruct rather than report" degrades exactly there. That is the
// client's text in the client's code — not something a server can fix, and not
// something we will paper over by re-authoring a refusal to suit one client's
// error formatting. The scope is precisely this: `connect()` on the modern leg.
// The legacy leg — the one a stock client meets — shows our sentence verbatim,
// and EVERY other refusal path is a `tools/call`, including a credential
// revoked mid-session, so all of them are unaffected on both legs.
//
// THE HONEST SUMMARY: O-009's definition of done — three tools exposed, every
// call organization-scoped and authenticated against a credential a person
// minted — is met, and O-013 adds the clause O-009 failed: a program nobody
// here wrote can now connect and call all three. The cross-tenant identity
// guarantee, the fail-closed credential gate, the read-only shape, the
// graceful-absence answers and a real client's whole session all have named
// tests. What this surface does not yet have is data to answer with.
//
// WHAT UNBLOCKS THAT, one line of this file: a `findings` table (with fixes and
// evidence) plus an org-scoped repository implementing `McpReadPort`; return it
// below instead of `createAbsentReadPort`. Its one hard obligation is written
// in that file's header — filter by organization in the SAME query as the id,
// so a foreign row is `null` and not a slower `null`.
//
// Nothing else in `@/lib/mcp` changes when it lands, because nothing else names
// a table, and only `@/lib/mcp/wire.ts` names a transport.

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
    // than a gap (the one gap named above).
    reads: absentReads,
  };
}

/** The whole protocol, on one verb: a single JSON-RPC message in, one answer
 * out. `tools/list` names what exists and `tools/call` runs one, and every one
 * of them only reads. */
export async function POST(request: Request): Promise<Response> {
  return handleMcpRequest(request, resolveMcpDeps());
}

/**
 * The verb this surface does not answer, answered anyway.
 *
 * EXPORTED RATHER THAN LEFT UNMOUNTED, ON PURPOSE. The catalogue moved onto the
 * wire protocol, so a `GET` has nothing left to serve — but a real client opens
 * a speculative one during every successful handshake, and an agent that tries
 * it deserves a sentence saying what to send instead. `handleMcpRequest`
 * answers 405 with exactly that; Next's own bodiless 405, which is what the
 * unmounted verbs get, would not.
 */
export async function GET(request: Request): Promise<Response> {
  return handleMcpRequest(request, resolveMcpDeps());
}
