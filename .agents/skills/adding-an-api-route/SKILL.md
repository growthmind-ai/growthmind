---
name: adding-an-api-route
description: Add or change a route under apps/web/app/api/ — composition-root shape, schema ownership, tenant scoping, and the cross-tenant proof a reviewer will ask for. Use for any API route, handler, or DTO change.
---

# Adding an API route

Two things are decided in a route file and nowhere else: **which organisation
the request is allowed to see**, and **which schema validates it**. Both are
easy to get wrong in a way that is green everywhere.

## The shape: the route file is a composition root

`route.ts` wires dependencies and calls a handler. It contains no business
logic, no query, and no validation of its own. Decisions live in `lib/`
modules that take their effects as ports, so the surface can be driven end to
end through its real entry point in tests.

[apps/web/app/api/mcp/route.ts](../../../apps/web/app/api/mcp/route.ts) is the
pattern to copy, including one detail worth stealing: it **exports its deps
resolver** so the composition itself has a test. A correct handler sitting
beside a route wired to the wrong credential source passes every other test in
the suite
([apps/web/\_\_tests\_\_/mcp/wiring.test.ts](../../../apps/web/__tests__/mcp/wiring.test.ts)).

## Schemas come from `packages/shared`

Do not declare a Zod schema in `apps/web`. The object that **validates** a call
must be the same object that **renders** the advertised/response shape — one
source, so there is no wire between a producer and a consumer to sever (D11).
This is enforced, not just recommended:
[apps/web/\_\_tests\_\_/mcp/no-direct-zod.test.ts](../../../apps/web/__tests__/mcp/no-direct-zod.test.ts).

At the DTO boundary, coerce rather than trust (D5). Production holds every
shape ever written, not the shape today's schema declares — jsonb columns
especially. A DTO that calls a method on a field whose historical shape differs
is a 500 waiting for an old row.

## Tenant scope: from the credential, never from the request

Every read and write is scoped to the organisation the session or API key
resolves to — **never to an id the request supplied** (D7). A client-supplied
`project_id` or `finding_id` is an input to a scoped query, not a scope.

Check each of these before you open the PR:

- Does the query go through the repository layer that injects the org filter?
  If you hand-wrote SQL or an aggregation, does it filter `organization_id`
  itself?
- Is a system/bypass context reachable from this user-triggered path? Grep the
  diff for it.
- For API-key callers: does the service still receive and enforce a tenant
  context, or is the route's auth the only thing standing there?

## The test a reviewer will ask for

A handler test with a fake credential source proves the handler. It does not
prove that a credential resolved from a **real** row lands in exactly one
organisation. The cross-tenant proof seeds two real organisations on one
database, mints a real key in each, and drives the real handler over it:
[apps/web/\_\_tests\_\_/mcp/cross-tenant-real-keys.test.ts](../../../apps/web/__tests__/mcp/cross-tenant-real-keys.test.ts).

Assert that actor-in-org-A gets **rejection or empty** for org B's row — not
that it "usually" returns their own data.

## Errors

- A 4xx for an unknown or malformed param, never a 500 (D9).
- An upstream vendor's error text never reaches a customer-visible field
  verbatim — it carries ids, and `z.string()` accepts all of them. Map it to a
  closed set of codes:
  [packages/adapters/src/slack/errors.ts](../../../packages/adapters/src/slack/errors.ts).
- Pick the fail direction deliberately and say which in a comment (D10).

## Server components

`page.tsx` files stay server components; client logic lives in a separate
`"use client"` component. A route change that drags `"use client"` up into a
page will be sent back.

## Verify

Call the route with the credential a real caller would use, from a running dev
server — see [verify-a-change](../verify-a-change/SKILL.md). A 200 with the
wrong scope is a failure, not a pass.
