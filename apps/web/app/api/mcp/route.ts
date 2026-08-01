import type { ScopedDb } from "@growthmind/db";

import { createApiKeyMcpCredentials } from "@/lib/mcp/credentials";
import { createAbsentReadPort } from "@/lib/mcp/read-port";
import { handleMcpRequest, type McpServerDeps } from "@/lib/mcp/server";
import { getDb } from "@/lib/db";

// The read-only machine surface, mounted (`docs/architecture.md`).
//
// Three tools, all reads, `list_open_fixes`, `get_fix`, `get_finding`. A `POST`
// carrying a JSON-RPC message is the only verb; `tools/list` names them and
// `tools/call` runs one. There is no other verb here and no tool that writes:
// `report_shipped`, the draft contract's one write tool, is absent from `MCP_TOOLS` and
// asserted absent by name in `packages/shared/__tests__/mcp/tools.test.ts`.
//
// This file is the composition root and nothing else. Every decision lives in
// `@/lib/mcp`, and the handler there takes both of its effects as ports, so the whole
// surface is driven end to end through its real entry point in
// `apps/web/__tests__/mcp/`, the same split `worker/src/tasks/delivery-tick.ts` and
// `worker/src/index.ts` use. `resolveMcpDeps` is exported for one reason: the
// composition itself needs a test, or a correct credential source can sit beside a
// route still wired to the wrong one with the whole suite green
// (`apps/web/__tests__/mcp/wiring.test.ts`).
//
// What this endpoint does on this installation today, and the one thing it still cannot
// do, because a half-true endpoint is worse than an absent one
//
// What works now. A person mints a read credential in one command (`bun
// scripts/mint-api-key.ts`) and hands it to their coding agent. The agent presents it
// as `Authorization: Bearer gmak_…`, and this route authenticates it against a real
// organization-scoped credential store. The `api_keys` table (`docs/architecture.md`),
// resolved by `resolveApiKeyForRead`. Every read below is scoped to the organization
// that credential resolves to and never to anything the request said, and revoking a
// key takes effect on the very next request because nothing here caches. The public
// write-key family is still refused, and now earlier than before: at the format check,
// before any database access at all. `@/lib/mcp/credentials.ts` carries that argument
// in full.
//
// One thing is still missing from this branch, and it is not something this route could
// invent.
//
// 1. No table records a finding or a fix. `packages/db/src/schema/` holds
//  finding signatures, dismissals and deliveries — the ledger and the
//  delivery record — and nothing a finding is stored in. So the read port is
//  the absent one: `list_open_fixes` answers with an empty list and a
//  truthful window, and both id lookups answer exactly as an unknown id does.
//  It does not crash, and it does not fabricate a row. See
//  `@/lib/mcp/read-port.ts`. The `findings` table is the, and building a
//  second one here would be the worst outcome available.
//
// This surface speaks MCP, and it serves both protocol eras from one handler
//
// A call is a JSON-RPC 2.0 message on the `POST`, and the catalogue arrives as
// `tools/list` on the same verb, `GET` is a 405 with a sentence saying so
// (`@/lib/mcp/refusals.ts`). `claude mcp add --transport http` against this URL
// connects: a stock client, constructed with no options at all, negotiates the legacy
// floor `2025-11-25` through the `initialize` handshake and lists three tools. The same
// handler also serves the modern `2026-07-28` era, which it advertises through
// `server/discover` to a client that asks for it. Neither leg is configuration; the
// transport serves both and offers no switch that turns either off.
//
// ⚠️ the reconciliation, because it is the trap the next reader hits. `2026-07-28` is
// absent from the transport package's own `SUPPORTED_PROTOCOL_VERSIONS`, and that
// absence is correct and asserted on purpose. That list is the legacy-era negotiation
// list, and an era that drops the `initialize` handshake has nothing to negotiate. It
// advertises itself by discovery instead. It is not a gap and it must not be "fixed" by
// editing the list. `@/lib/mcp/wire-constants.ts` carries the same warning beside the
// constant, and a real client proves the era is served by refusing to connect any other
// way.
//
// An honest shortfall, recorded rather than engineered around. Our 401 is produced
// before the transport is anywhere in the call stack, so its bytes are identical on
// both eras. But on the modern leg's `connect` only, the client's own
// version-negotiation probe replaces our sentence with its own ("Version negotiation
// failed: the server requires authorization (HTTP 401)"), so "errors instruct rather
// than report" degrades exactly there. That is the client's text in the client's code,
// not something a server can fix, and not something we will paper over by re-authoring
// a refusal to suit one client's error formatting. The scope is precisely this:
// `connect` on the modern leg. The legacy leg (the one a stock client meets) shows
// our sentence verbatim, and every other refusal path is a `tools/call`, including a
// credential revoked mid-session, so all of them are unaffected on both legs.
//
// The honest summary: the definition of done. Three tools exposed, every call
// organization-scoped and authenticated against a credential a person minted. Is met,
// and adds the clause failed: a program nobody here wrote can now connect and call all
// three. The cross-tenant identity guarantee, the fail-closed credential gate, the
// read-only shape, the graceful-absence answers and a real client's whole session all
// have named tests. What this surface does not yet have is data to answer with.
//
// What unblocks that, one line of this file: a `findings` table (with fixes and
// evidence) plus an org-scoped repository implementing `McpReadPort`; return it below
// instead of `createAbsentReadPort`. Its one hard obligation is written in that file's
// header. Filter by organization in the same query as the id, so a foreign row is
// `null` and not a slower `null`.
//
// Nothing else in `@/lib/mcp` changes when it lands, because nothing else names a
// table, and only `@/lib/mcp/wire.ts` names a transport.

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
    // The absent read port, deliberately: the `findings` table is the, and its
    // truthful-empty answers are this sprint's acceptance criterion rather than a gap
    // (the one gap named above).
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
