# Decision 0010: The findings table, one identity producer and a retry-guard index

**Status: Decided.** Recorded 2026-08-01, extracted verbatim-in-substance from the
file header of `packages/db/src/schema/findings.ts` when long-form rationale moved to
docs.

**Decides:** how a persisted finding gets its identity, why the unique index leads
with the organization, and what null means on every nullable column.
**Implemented by:** `packages/db/src/schema/findings.ts`

---

## The consumer wire, cut and then closed

The table holds one row per finding the analysis lane persisted, the first
analysis-side persistence in this repository. Its consumer is the delivery lane, and
that wire shipped deliberately cut: delivery was missing two halves, a lane source and
a poster built from a `slack_connections` row that did not exist, so wiring candidates
through then would have produced a wire that looked connected and was not.

That reason has since expired. The `slack_connections` table now exists, declared
beside this one in `packages/db/src/schema/slack-connections.ts`, and the onboarding
work closed the wire and added two readers: the first-run status read, which takes the
single newest finding for the project a founder is watching, and the delivery lane
source, which composes an organization's undelivered findings for its own channel. Both
reach these rows through the table's repository under an org-scoped context, and
neither reaches them any other way. There is still no method on the repository that
takes an organization id. The same statement is carried on
`packages/db/src/repositories/findings.repo.ts`.

## Signature is the finding's identity, with exactly one producer

The `signature` column stores the signature the ledger already defines; it is the
finding's identity, not a handle. Identity has exactly one producer,
`computeFindingSignature` (`packages/db/src/services/signature-ledger.service.ts`),
which composes `signatureTuple` (pure, in `@growthmind/core`) and `sha256Hex`. Nothing
re-implements that hash. The walker (`worker/src/tasks/analysis-tick.ts`) calls that
one function and writes what it returns. A stored copy beside the ledger is the
pattern `deliveries.signature` and `dismissals.signature` already set twice, for the
same reason: an identity that resolves without a join to the row that carries it.

## The forking hazard ships today

The hazard a stored identity raises is forking. A signature is exactly as stable as
its least stable input, and the surface is re-derived. The mechanism for surviving
that hazard exists; its producer does not, and the column ships forkable. The ancestry
table (`signature_ancestry`), the service method that writes an edge
(`recordAncestry`) and the old-to-new resolution that reads it (`consultSignature`)
all shipped, but nothing in production calls `recordAncestry`. Its only callers are
the db package's own tests, and the analysis lane stubs it out. No ancestry edge is
written by any shipped path, so the migration path is a capability rather than a
behaviour. Read that before hanging anything off this value.

What that costs, concretely: the signature-tuple input table in `@growthmind/core`'s
`signature-tuple.ts` names three live churn events for the surface id, a customer
route rename, a `URL_PATH_NORMALISATION_VERSION` bump, and the planned swap to
ts-morph surface derivation, plus an `EVIDENCE_SHAPE_VERSION` bump for the evidence
shape. Any one of them forks the column with no edge recorded, and the fork is silent:
the unique index matches nothing, the finding re-mints as new, `findBySignature`'s
reuse rung misses, the cap's lifetime ceiling re-opens for a problem already paid for
(see `packages/db/src/schema/analysis-model-calls.ts`), and the dismissals quietly
stop suppressing it. The heir is a caller for `recordAncestry` on whichever path
re-derives a surface, not a second mechanism.

## Provenance beside identity

`signature_version` sits beside the value so provenance is read, never re-derived, the
same discipline as `finding_signatures.signature_tuple_version`. A signature and the
version of the tuple serialisation that produced it are one fact; separating them is
how a normaliser bump becomes an invisible fork.

## Why not a positional key

What a positional key would have done instead is the reason the column is what it is:
an ordinal-and-tick-instant handle mints a fresh identity every hour, so the unique
index would match nothing, the cap's lifetime ceiling would become a per-tick one, and
`findBySignature`'s reuse rung would never hit. This overruled the first draft of the
design.

## The unique index is the retry guard

`findings_org_project_signature_key` is unique on
`(organization_id, project_id, signature)`. The persist path inserts against it and
reads the existing row on conflict, so a Graphile Worker replay of the analysis task
is a conflict rather than a second finding, and so is a later tick that re-derives the
same identity. That is what makes "one row per problem per project" true rather than
aspirational.

The tuple leads with `organization_id` on purpose: a signature is content-derived, so
two organizations with the same funnel shape on the same page path will produce the
same string. An index without the org column would hand whichever org ran second the
other's finding back through its own on-conflict read.

## Text is a headline plus a sentence array

`headline` is text; `context` is jsonb holding `readonly string[]`, one sentence per
element, for both lanes. The guard's judgement is per sentence, and the Slack renderer
and residual-PII scanner both consume sentences. Re-splitting prose downstream is the
step that stops being reliable the moment a model writes it, so the model arm is split
once, by the guard, before it reaches the column, and never again.

## Jsonb is parsed at the boundary, never trusted

`context` and `counts` are intentionally left as `unknown` at the type level. A jsonb
column holds every shape ever written, not the shape the current code writes, so the
repository validates both on write and on read. A `$type` annotation here would be a
promise about persisted data that nothing enforces.

## Null means "not reported", never zero

`resolved_model_id` is null iff no call was attempted for this candidate, and that
holds on every path, including the defensive one where the port throws instead of
returning, because the lane carries the model id the composition root resolved beside
the port itself (`worker/src/tasks/analysis-tick.ts`, `ConfiguredSummariser`). There
is no path on which an attempted call lands a null here.

`tokens_in` / `tokens_out` are null when the SDK reported no count. A candidate the
model touched but did not meter must never look identical to one that cost nothing; a
genuinely reported `0` is a different, storable fact.

`surface_normalisation_version` is null for the same class of reason: the candidate
contract makes it a nullable integer and deliberately not positive-only
(`packages/core/src/findings/candidate.ts`), so `0` is a version a normaliser may
legitimately report. Writing `0` to mean "none recorded" would make "normaliser v0"
and "we do not know" the same stored value, on a column that feeds identity
comparisons: the exact defect the token columns exist to avoid.

## Closing window

Nothing has shipped against this table. It lands empty in every environment, so there
is nothing to backfill today. That is a closing window, not a standing exemption.
