import { createWriteKeyMcpCredentials } from "@/lib/mcp/credentials";
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
// `apps/web/__tests__/mcp/` with fakes — the same split
// `worker/src/tasks/delivery-tick.ts` and `worker/src/index.ts` use.
//
// ===========================================================================
// WHAT THIS ENDPOINT ACTUALLY DOES ON THIS INSTALLATION TODAY: NOTHING, AND
// HERE IS EXACTLY WHY, BECAUSE A HALF-TRUE ENDPOINT IS WORSE THAN AN ABSENT ONE
// ===========================================================================
//
// TWO SEPARATE THINGS ARE MISSING FROM THIS BRANCH, AND NEITHER IS SOMETHING
// THIS ROUTE COULD INVENT.
//
// 1. NO CREDENTIAL THIS SURFACE ACCEPTS EXISTS. The only credential store here
//    is `write_keys`, and those are PUBLIC by design — `docs/architecture.md`
//    §4.2 calls them "spoofable by construction", because they ship inside the
//    customer's own web page. A key anyone can read out of a page source must
//    never grant a read of every finding in an organization, so neither
//    `standard` nor `simulation` is admissible here. The credential this
//    surface wants is `api_keys` (§6, a separate table for a separate thing),
//    which has no schema in this branch. `@/lib/mcp/credentials.ts` carries the
//    full argument and the gate that enforces it. CONSEQUENCE: every request to
//    this route is refused today, and the refusal is the same one an attacker
//    with a scraped key gets.
//
// 2. NO TABLE RECORDS A FINDING OR A FIX. `packages/db/src/schema/` holds
//    finding signatures, dismissals and deliveries — the ledger and the
//    delivery record — and nothing a finding is stored in. So the read port is
//    the absent one: `list_open_fixes` answers with an empty list and a
//    truthful window, and both id lookups answer exactly as an unknown id does.
//    It does not crash, and it does not fabricate a row. See
//    `@/lib/mcp/read-port.ts`.
//
// THE HONEST SUMMARY, in the same terms `resolveDeliveryComposition` states its
// own gap: O-009's definition of done — three tools exposed, every call
// org-scoped and authenticated — is met and proven, but proven against fakes
// driving the real entry point, not against production traffic. The
// cross-tenant identity guarantee, the fail-closed credential gate, the
// read-only shape and the graceful-absence answers all have named tests. What
// they do not yet have is data to answer with or a key to answer to.
//
// WHAT UNBLOCKS EACH, one line of this file per gap:
//   - credentials: an `api_keys` table plus a repository resolving a presented
//     key to its organization, fail-closed on unknown/revoked exactly as
//     `resolveWriteKeyForIngest` is; return that source below instead.
//   - reads: a `findings` table (with fixes and evidence) plus an org-scoped
//     repository implementing `McpReadPort`; return it below instead of
//     `createAbsentReadPort`. Its one hard obligation is written in that file's
//     header — filter by organization in the SAME query as the id, so a foreign
//     row is `null` and not a slower `null`.
//
// Nothing else in `@/lib/mcp` changes when either lands, because nothing else
// names a table.

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

function resolveMcpDeps(): McpServerDeps {
  return {
    // A REAL gate over the real credential store, which refuses every key in
    // it. Not a stub: it resolves the presented material exactly as ingest
    // does and then refuses on KIND, which is the decision this outcome had to
    // make and the thing its test proves against a genuinely minted key.
    credentials: createWriteKeyMcpCredentials(getDb()),
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
