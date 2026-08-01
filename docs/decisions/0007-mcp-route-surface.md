# Decision 0007: The mounted MCP route, what it serves and what it cannot yet

**Status: Decided.** Recorded 2026-08-01, extracted verbatim-in-substance from the
file header of `apps/web/app/api/mcp/route.ts` when long-form rationale moved to docs.

**Decides:** what the mounted read-only machine surface serves on this installation
today, which protocol eras it speaks, and the one thing it still cannot answer.
**Implemented by:** `apps/web/app/api/mcp/route.ts`

---

## The shape of the surface

Three tools, all reads: `list_open_fixes`, `get_fix`, `get_finding`. A `POST` carrying a
JSON-RPC message is the only verb; `tools/list` names the tools and `tools/call` runs
one. There is no other verb here and no tool that writes: `report_shipped`, the draft
contract's one write tool, is absent from `MCP_TOOLS` and asserted absent by name in
`packages/shared/__tests__/mcp/tools.test.ts`.

The route file is the composition root and nothing else. Every decision lives in
`apps/web/lib/mcp`, and the handler there takes both of its effects as ports, so the
whole surface is driven end to end through its real entry point in
`apps/web/__tests__/mcp/`, the same split `worker/src/tasks/delivery-tick.ts` and
`worker/src/index.ts` use. `resolveMcpDeps` is exported for one reason: the composition
itself needs a test, or a correct credential source can sit beside a route still wired
to the wrong one with the whole suite green
(`apps/web/__tests__/mcp/wiring.test.ts`).

## What works now

A person mints a read credential in one command (`bun scripts/mint-api-key.ts`) and
hands it to their coding agent. The agent presents it as
`Authorization: Bearer gmak_...`, and the route authenticates it against a real
organization-scoped credential store: the `api_keys` table (`docs/architecture.md`),
resolved by `resolveApiKeyForRead`. Every read is scoped to the organization that
credential resolves to and never to anything the request said, and revoking a key takes
effect on the very next request because nothing here caches. The public write-key family
is refused at the format check, before any database access at all;
`apps/web/lib/mcp/credentials.ts` carries that argument in full.

## The one thing still missing, and why the route cannot invent it

No table records a finding or a fix. `packages/db/src/schema/` holds finding signatures,
dismissals and deliveries (the ledger and the delivery record) and nothing a finding is
stored in. So the read port is the absent one: `list_open_fixes` answers with an empty
list and a truthful window, and both id lookups answer exactly as an unknown id does. It
does not crash, and it does not fabricate a row. See `apps/web/lib/mcp/read-port.ts`.
The `findings` table is another sprint's deliverable, and building a second one here
would be the worst outcome available.

A half-true endpoint is worse than an absent one; the truthful-empty answers are an
acceptance criterion rather than a gap.

## Both protocol eras, from one handler

A call is a JSON-RPC 2.0 message on the `POST`, and the catalogue arrives as
`tools/list` on the same verb; `GET` is a 405 with a sentence saying so
(`apps/web/lib/mcp/refusals.ts`). `claude mcp add --transport http` against this URL
connects: a stock client, constructed with no options at all, negotiates the legacy
floor `2025-11-25` through the `initialize` handshake and lists three tools. The same
handler also serves the modern `2026-07-28` era, which it advertises through
`server/discover` to a client that asks for it. Neither leg is configuration; the
transport serves both and offers no switch that turns either off.

## The reconciliation, because it is the trap the next reader hits

`2026-07-28` is absent from the transport package's own `SUPPORTED_PROTOCOL_VERSIONS`,
and that absence is correct and asserted on purpose. That list is the legacy-era
negotiation list, and an era that drops the `initialize` handshake has nothing to
negotiate. It advertises itself by discovery instead. It is not a gap and it must not be
"fixed" by editing the list. `apps/web/lib/mcp/wire-constants.ts` carries the same
warning beside the constant, and a real client proves the era is served by refusing to
connect any other way.

## An honest shortfall, recorded rather than engineered around

Our 401 is produced before the transport is anywhere in the call stack, so its bytes are
identical on both eras. But on the modern leg's `connect` only, the client's own
version-negotiation probe replaces our sentence with its own ("Version negotiation
failed: the server requires authorization (HTTP 401)"), so "errors instruct rather than
report" degrades exactly there. That is the client's text in the client's code, not
something a server can fix, and not something we will paper over by re-authoring a
refusal to suit one client's error formatting. The scope is precisely this: `connect` on
the modern leg. The legacy leg (the one a stock client meets) shows our sentence
verbatim, and every other refusal path is a `tools/call`, including a credential revoked
mid-session, so all of them are unaffected on both legs.

## The honest summary

The definition of done (three tools exposed, every call organization-scoped and
authenticated against a credential a person minted) is met, and so is the clause that
used to fail: a program nobody here wrote can now connect and call all three. The
cross-tenant identity guarantee, the fail-closed credential gate, the read-only shape,
the graceful-absence answers and a real client's whole session all have named tests.
What this surface does not yet have is data to answer with.

## What unblocks it, one line of the route

A `findings` table (with fixes and evidence) plus an org-scoped repository implementing
`McpReadPort`; return it from `resolveMcpDeps` instead of `createAbsentReadPort`. Its
one hard obligation is written in the header of `apps/web/lib/mcp/read-port.ts`: filter
by organization in the same query as the id, so a foreign row is `null` and not a slower
`null`.

Nothing else in `apps/web/lib/mcp` changes when it lands, because nothing else names a
table, and only `apps/web/lib/mcp/wire.ts` names a transport.
