# Decision 0007: The mounted MCP route, what it serves and what it cannot yet

**Status: Decided.** Recorded 2026-08-01, extracted verbatim-in-substance from the
file header of `apps/web/app/api/mcp/route.ts` when long-form rationale moved to docs.
**Amended 2026-08-04** (O-020): the read port went live. The sections below marked
_Amended_ replace what they say; nothing above them has been rewritten to look
prescient.

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

## What works now — _Amended 2026-08-04_

A person mints a read credential in one command (`bun scripts/mint-api-key.ts`) and
hands it to their coding agent. The agent presents it as
`Authorization: Bearer gmak_...`, and the route authenticates it against a real
organization-scoped credential store: the `api_keys` table (`docs/architecture.md`),
resolved by `resolveApiKeyPrincipal`. That resolver reads the organization out of the
database keyed by the digest of the presented secret, and returns the whole tenant
context the request then acts in, so no caller can name the tenancy it reads from. It
replaced `resolveApiKeyForRead`, which returned an organization id alone; both existed
for one sprint and only one does now, because a correct credential path beside a wrong
one is exactly the failure `resolveMcpDeps` is exported to make testable.

Every read is scoped to the organization that credential resolves to and never to
anything the request said, and revoking a key takes effect on the very next request
because nothing here caches. The public write-key family is refused at the format check,
before any database access at all; `apps/web/lib/mcp/credentials.ts` carries that
argument in full.

## The one thing that was missing, and what shipped instead — _Amended 2026-08-04_

**As recorded on 2026-08-01:** no table recorded a finding or a fix, so the read port was
the absent one — `list_open_fixes` answered an empty list with a truthful window, and
both id lookups answered exactly as an unknown id does. A half-true endpoint is worse
than an absent one, and the truthful-empty answers were an acceptance criterion rather
than a gap.

**What shipped in O-020:** the `fixes` and `finding_payloads` tables, an org-scoped
repository and `FixesService` over them (`packages/db`), and
`createLiveReadPort` (`apps/web/lib/mcp/read-port-live.ts`), which `resolveMcpDeps`
now returns. All three tools read real rows. `createAbsentReadPort` remains in
`apps/web/lib/mcp/read-port.ts` as the self-host-with-no-data path and has no production
caller, which is asserted by a scan rather than by inspection
(`apps/web/__tests__/mcp/wiring.test.ts`, "binds no absent read port in the production
route").

**What is still honestly absent.** A finding carries the payload a fix spec is rendered
from only if it was written after this sprint's lane change. A finding written before it
has no payload row, so `get_fix` cannot be minted for it and `get_finding` derives no
observations from it — both answer the same typed not-found an id that never existed
answers. That is a refusal, not a fault, and the difference is load-bearing: the port
returns `null` rather than handing `call-tool.ts` a record whose `evidence` array would
fail the schema's `.min(1)` and surface as an internal error.

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

## The honest summary — _Amended 2026-08-04_

The definition of done (three tools exposed, every call organization-scoped and
authenticated against a credential a person minted) is met, and so is the clause that
used to fail: a program nobody here wrote can now connect and call all three. The
cross-tenant identity guarantee, the fail-closed credential gate, the read-only shape,
the graceful-absence answers and a real client's whole session all have named tests.
What this surface lacked on 2026-08-01 was data to answer with; it has that now, for
findings written after O-020's lane change and not for the ones before it.

## The obligation, and where it is asserted — _Amended 2026-08-04_

The read port's one hard obligation was written as a header comment in
`apps/web/lib/mcp/read-port.ts` while nothing implemented it: filter by organization in
the same query as the id, so a foreign row is `null` and not a slower `null`. It is now
structural — `createLiveReadPort` composes `createFixesService`, whose reads go through
`orgCrud.maybe`, which is `and(org(table), eq(id, …))` — and it is asserted rather than
described, by `apps/web/__tests__/mcp/cross-tenant-real-keys.test.ts` ("refuses org B's
fix to org A's key on every tool"), which proves the refusal is byte-identical to the
one for an id that never existed.

Nothing else in `apps/web/lib/mcp` names a table, and only `apps/web/lib/mcp/wire.ts`
names a transport.
