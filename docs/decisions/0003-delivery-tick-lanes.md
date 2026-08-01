# Decision 0003: How the delivery lane decides, clears, claims and posts

**Status: Decided.** Recorded 2026-08-01, extracted verbatim-in-substance from the
file header of `worker/src/tasks/delivery-tick.ts` when long-form rationale moved to
docs.

**Decides:** the order of the delivery pipeline, why the PII scan runs over the exact
text posted, why a claim precedes every post, and why nothing-today is never posted.
**Implemented by:** `worker/src/tasks/delivery-tick.ts`

---

## The shape: a composition root with no queue types

`runDeliveryTick` is a plain exported async function with no queue types in its
signature, so it is unit-testable without a queue and the whole lane can be driven end
to end through the real consumer entry point with fakes. Registration lives in
`worker/src/index.ts`, the only queue-aware file, the same split
`./session-source-poll.ts` uses, and for the same reason.

Nothing in this file decides anything. Every judgement was made by a pure function
that already shipped, and the tick's whole job is to run them in the one order that
cannot leak, cannot double-post, and cannot jam:

decide (`decideDelivery`) then render (`renderSlackMessage`) then scan
(`scanResidualPii`) then claim (`claimForPost`) then post then terminal state.

## The scan runs over the text that will actually be sent

The outcome's definition of done is "the residual PII scanner passes over generated
text before any push or post", and a gate that scans a different string from the one
posted is a gate that does nothing: the shape where a value is computed and then
dropped on the floor. So the `PostRequest` is built first, `textPostedFor` derives the
scanned string from that very object, and the object handed to the poster is the same
reference. Scanning the model's raw input instead would clear text nobody sends and
post text nobody cleared.

This holds structurally, not by discipline: `poster.post` is reachable on exactly one
branch (the one where `prepared.ok` is true) and `prepare` is the only producer of
that value. A refusal cannot be routed around without deleting the branch.

A dirty scan does not post, records the delivery `failed` with a sentence from
`@growthmind/shared`'s one home, and never quotes the offending text: echoing the
match would copy the personal data into the row, the logs, and every alert built on
them, relocating the leak instead of closing it. The finding is untouched and stays
deliverable (a `failed` row is re-claimable), so a fixed summary goes out on a later
tick.

## Claim before post, always

`claimForPost` is one atomic statement against the unique index; a
`{claimed: false}` means another worker (or a Graphile Worker retry of a job that
already got as far as posting) owns this post. On that answer the handler does
nothing and returns. No post, no terminal write, no log-level error. It is the
ordinary outcome of two ticks overlapping, not a fault. There is no "does a delivery
already exist?" read before the claim, so two overlapping ticks cannot both conclude
they may post.

The render and the scan run before the claim. Both are pure and cost nothing to redo,
so doing them first means a message the lane will refuse never becomes a `pending`
row that then has to be unwound.

## Every exit path is terminal

A claimed row starts `pending`, and a row left `pending` shows up in
`listPendingForProject` forever, which makes the scheduler answer `one_already_open`
on every future tick and jams the lane silently, with no error anywhere. So every
path out of a successful claim records `posted` or `failed`: the poster's `ok: false`
arm, an unexpected throw from the poster (a port contracted never to throw is still a
port somebody can break), a render refusal, and the PII refusal. The only path that
can leave a `pending` row is a terminal write that itself fails, and that one is
logged loudly.

## Per-lane isolation

One project's failure cannot abort the batch; a sibling project still delivers. The
per-lane try/catch is belt-and-braces on top of the branch-level handling inside a
lane's turn, so a fault in the paths around a delivery (the repository construction,
the context build) still cannot take the tick down.

## Nothing-today is decided, logged, and not posted

The decision, and why the shape of the data forces it:

`deliveries` deliberately has no row shape for a nothing-today. It has no
`finding_id`, and giving it one would mean making that column nullable, voiding the
`(organization_id, finding_id, channel_id)` unique index that is the idempotency
guard this whole lane rests on (see the header of
`packages/db/src/schema/deliveries.ts`). Nothing else in this branch's history
persists a scheduler day-state either.

So there is no key on which "have we already said this today?" could be asked. A
nothing-today post would therefore be an unkeyed post from a cron tick: it would
repeat on every tick, forever, and the customer's channel would fill with us saying
nothing, exactly the spam this table's index exists to make impossible for findings.
Between "say nothing this tick" and "possibly say nothing dozens of times a day",
only one of those can be un-sent. It is not posted.

That also matches the product ruling this lane was written against: nothing-today
never posts to Slack at MVP, because a daily "nothing today" post erodes the
channel's signal. The tick logs the reason, counts it in the summary, and creates no
`deliveries` row.

### The planned follow-up

The honest version of a posted nothing-today needs persistence that still does not
exist: a scheduler day-state row keyed `(project, day)`. That row is what would make a
nothing-today idempotent, turning the branch into a claim-then-post exactly like the
deliver arm, with the day key playing the part the unique index plays here. The
onboarding work wired the lane and the poster and deliberately did not add it, so the
reason remains a log line and a counter rather than a message, and `nothing_today` is
read from the app rather than pushed at anybody.

## The open set is a persisted fact

The scheduler's "is one already open?" question is answered from
`listPendingForProject`, read under the org's filter inside the handler itself, never
a transient signal and never a number the lane source computed. A lane source
computing that number separately would be a stamp/filter asymmetry waiting to happen.

Today "open" means a delivery still `pending`, because a finding awaiting the
customer's answer has no table in this branch's history. When the analysis lane's
`findings` table carries that state, the read becomes "findings awaiting an answer"
and a posted-but-unanswered finding starts holding the lane the way the product
decision intends. Until then the backpressure is real but shorter-lived than
intended.

## Tenant scope comes from the lane row

There is no payload (the task is cron-triggered), so there is nothing a caller could
supply an organization id through even in principle. The context is built from the
lane the source read, parsed through the same `tenantContextSchema` a request-derived
context is, and every repository is constructed org-scoped from it.
