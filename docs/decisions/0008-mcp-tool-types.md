# Decision 0008: The MCP tool wire shapes, naming and tenant rules

**Status: Decided.** Recorded 2026-08-01, extracted verbatim-in-substance from the
file header of `packages/shared/src/mcp/types.ts` when long-form rationale moved to
docs.

**Decides:** where the read-only machine surface's wire shapes live, the two naming
conventions they follow, and the tenant rule no input schema may break.
**Implemented by:** `packages/shared/src/mcp/types.ts`

---

## What lives in this file, and what deliberately does not

The file holds the wire shapes for the three tools of this slice, all reads:
`list_open_fixes`, `get_fix`, `get_finding` (`docs/architecture.md`; the draft
machine-surfaces contract). The descriptors that bind these shapes to their names live
in `packages/shared/src/mcp/tools.ts`; the HTTP/stdio route that serves them is a later
slice. The fix spec's prose (structured state rendered to plain sentences under fixed
headings) belongs to `packages/core`, not here, which is why the envelope schema carries
the rendered spec as one opaque string and declares none of its sections: if this file
also declared the spec's sections, there would be two shapes describing one artefact,
and a schema change in one would silently stop matching the other (see
`fixSpecEnvelopeSchema`'s own doc comment for the full boundary argument).

## Why `packages/shared`

It depends on `zod` only (never `@growthmind/core`, never `@growthmind/db`), and both
the producer (a route in `apps/web`) and any consumer will already depend on it. The
same reasoning put the SummaryRenderer port's shapes in
`packages/shared/src/summary/types.ts`.

## Two naming decisions, both deliberate

1. Tool names are snake_case (`list_open_fixes`) and are quoted verbatim in the
   definition of done and in the draft contract. They are the wire, so they are pinned
   as constants and asserted in `packages/shared/__tests__/mcp/tools.test.ts`. This is
   the hazard `worker/src/task-names.ts` documents at length: a renamed tool is not a
   compile error anywhere; it is a capability that silently stops being reachable,
   because a client asks for tools by string.

2. Field names are camelCase, and this is a considered deviation from the draft
   contract's `fix_id` / `finding_id` prose. Every Zod schema in this package is
   camelCase (`totalInWindow`, `resolvedModelId`, `surfaceNormalisationVersion`), and
   one convention per repository beats matching a draft's incidental key style. What the
   contract actually requires is that every response carries both ids: an agent working
   across turns loses the thread otherwise, and a fix applied to the wrong finding is
   worse than no fix. That requirement is met literally: `fixId` and `findingId` are
   required on every output shape, and a named test pins it. Field style is cosmetic;
   carrying both ids is not.

## The org is never an argument

No input schema in this file has an organization key, and none may grow one. The
organization comes from the authenticated credential the call arrived on and from
nowhere else, so "give me another tenant's fixes" is not a sentence this contract can
express. This is the lesson `packages/db/__tests__/repositories/no-org-param.test.ts`
already pays for at the repository and service layers, restated at the layer a
customer's coding agent can actually reach.
`packages/shared/__tests__/mcp/tools.test.ts` walks every input schema's keys
recursively and fails on one.

## The residual risk, handed forward in writing

The client-supplied ids (`fixId`, `findingId`, `projectId`) are the residual risk, and
the schema cannot close it: an id is just a string. This is an inherited obligation for
whoever writes the route. Every id must be resolved inside the credential's
organization, and an id belonging to another organization must answer exactly as an id
that does not exist does. A distinguishable "not yours" answer is itself a cross-tenant
read. There is no code in this file to test that against; it is a requirement handed
forward, not a guarantee already met.
