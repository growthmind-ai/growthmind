# Decision 0012: The signature ledger's contract, five entry points and one fail direction

**Status: Decided.** Recorded 2026-08-01, extracted verbatim-in-substance from the
file header of `packages/db/src/services/signature-ledger.service.ts` when long-form
rationale moved to docs.

**Decides:** the ledger service's consumer contract, and the single fail direction
every read and write path shares when an ancestry walk cannot be resolved.
**Implemented by:** `packages/db/src/services/signature-ledger.service.ts`

---

## The consumer contract

The service is the signature ledger's consumer contract: the five entry points a later
outcome's analysis lane, delivery scheduler, and Slack responder call, plus the one
composition that turns a candidate into a signature. Each entry point's header comment
in the source names its intended caller; those comments stay at the definition site
because they are the wiring record a reviewer reads.

Parameter order: every method takes the project id first, matching every other
repository and service in the package (`listForProject`, `findByKey`, `aggregateFor`
and the rest). An earlier draft listed a couple of these with the project id second;
the service puts it first for consistency with the rest of the codebase. The two
differ only in argument order, never in meaning.

## Producer/consumer wiring: derive, never hand-pass

The failure this project has paid to learn twice, a computed value dropped on the
floor because no consumer ever reads it, is closed by never hand-passing a value a
consumer could derive itself: every method derives what it needs from its own
arguments (a `CandidateFinding`, a `SignatureHex`, a `TenantContext`), never from an
out-of-band field a caller forgot to thread.

## Reads are uncached, committed-state only

A stale "not seen" here is a duplicate delivered. There is no cache in front of any
read in this service, and a later wave must not add one without re-litigating this
note.

## One composition turns a candidate into a signature

`computeFindingSignature` composes `signatureTuple` (pure, in `@growthmind/core`) and
`sha256Hex` (`packages/db/src/signatures/hex.ts`). It is the one function that turns a
candidate into a signature, and the only caller of `sha256Hex` in production code.

## Ancestry-forward resolution on every path

Every other method resolves its input signature forward through the ancestry table
before touching the ledger. A stale pre-re-key signature (for example a Slack
interaction payload minted before a churn) must land on the live row, never silently
stamp a signature nothing consults anymore.

## The one fail direction for an unresolvable ancestry walk

Stated once, because the read path and the write paths must not disagree about it. An
earlier revision had `consultSignature` suppress on an unresolvable walk while
`resolveForward` degraded to the unresolved input, so a dismissal was stamped onto a
signature the read path had just declared unknowable.

The rule: an unresolvable walk never moves the system toward an extra delivery, and
never discards a customer's action. Concretely:

- `consultSignature` (read): suppress, with the unresolvable-ancestry resolution.
- `recordDismissal` (write): record against the unresolved input signature.
- `markSignatureDelivered` (write): stamp the unresolved input signature.

Those are one direction, not two: every branch either withholds a delivery or records
something whose only effect is more suppression. Refusing the writes was considered
and rejected. A throw inside `recordDismissal` destroys the customer's "Not useful"
click outright, the worst available outcome, and it destroys it in exactly the state
where the ledger is already known to be sick. Recording against the unresolved
signature loses nothing: a dismissal keyed on that signature still suppresses it, and
if the ancestry chain is later repaired, `recordAncestry`'s carry-forward propagates
the dismissal onto the live row via its coalesce. Both unresolvable branches log at
`console.error`.

## The dismissal is durable independently of the ledger

The dismissals table and the ledger table have two independent producers with no
ordering guarantee: a Slack "Not useful" click can arrive before the analysis lane has
ever recorded the signature. `recordDismissal` therefore treats the dismissals row as
the durable record of the customer's decision and the ledger's dismissed-at stamp as a
denormalised fast path, never the other way round. `consultSignature` reads both, so
the suppression holds regardless of arrival order.

## Transactions write on the handle directly

`recordDismissal` and `recordAncestry` each open exactly one
`db.transaction(async (tx) => ...)` and write on `tx` directly, never through a
repository factory constructed over `tx`, because `ScopedDb`
(`packages/db/src/repositories/types.ts`) is a union of `NodePgDatabase` and
`PgliteDatabase` that a transaction handle is not assignable to without a cast.
`packages/db/src/tenancy/ensure-organization.ts` is the precedent this copies:
hand-written queries inside the callback, every query naming the caller's organization
id literally. Repository factories (`createFindingSignaturesRepo`,
`createSignatureAncestryRepo`) are used everywhere else, where a single read or a
single atomic upsert is enough.
