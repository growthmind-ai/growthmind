# Decision 0002: How the analysis lane runs one check

**Status: Decided.** Recorded 2026-08-01, extracted verbatim-in-substance from the
file header of `worker/src/tasks/analysis-tick.ts` when long-form rationale moved to
docs.

**Decides:** the orchestration contract for the analysis tick, the fixed ladder of
degradations, and why every exit path persists and closes.
**Implemented by:** `worker/src/tasks/analysis-tick.ts`

---

## The shape: a composition root with no queue types

`runAnalysisTick` is a plain exported async function with no queue types in its
signature, so the whole lane is driven end to end through the real consumer entry
point with fakes at the ports. Registration lives in `worker/src/index.ts`, the only
queue-aware file. `./delivery-tick.ts` and `./session-source-poll.ts` use the same
split, for the same reason.

Nothing in this file decides what is true about a customer's product. Every judgement
was made upstream by a pure function that already shipped; the lane's whole job is to
run a fixed ladder in the one order whose failure classes cannot collapse into each
other, and to make sure a finding lands whichever rung it falls to.

## Where the lane lives

The tick file owns the run: open, walk, persist, close, and the per-lane isolation
around all four. The pieces it walks with live beside it, one concern each, because a
single file carrying the vocabulary, the ladder, the tally and the run loop had grown
past the point where any of them could be read on its own:

- `worker/src/analysis/types.ts`: every shape the lane shares, and no behaviour
- `worker/src/analysis/shapes.ts`: candidate to store row, candidate to model input
- `worker/src/analysis/gates.ts`: the three refusal points, each isolating its own
  fault
- `worker/src/analysis/plan.ts`: the ladder, one candidate's turn, rung by rung
- `worker/src/analysis/tally.ts`: what the run row will say when it closes

The ladder's order and the reasoning behind each rung are documented at the top of
`worker/src/analysis/plan.ts`, beside the code that implements them. What follows here
is the contract the whole lane is judged against, which is a property of the sequence
rather than of any one rung.

## The gate before the ladder

One gate stands before the ladder, and it is not a rung: a candidate whose `surface`
is not already in its normalised form is refused before anything is claimed, sent,
written or hashed. The gate was added by the security audit. It is not a degradation.
There is no rung for it, no `floor_*` sentence, and no finding row, because the hazard
it answers is not "we could not write this up" but "this value may not leave the
process at all". See `surfaceIsSafeToSend` in `worker/src/analysis/gates.ts`.

## The identity is derived once, before the claim

Immediately after that gate and before the first rung, `identityFor` calls
`computeFindingSignature` (the product's one producer of a signature) and the value it
returns is what the cap claim, the reuse read and the persist all key on.
Content-derived, so the same problem is the same identity across ticks, across
reorderings and across processes; a positional or tick-prefixed handle would fork
every hour and quietly turn a lifetime cap into a per-tick one.

Nothing in `worker/` hashes anything: a second composition of `signatureTuple` and
`sha256Hex` is the fork this arrangement exists to make impossible. A derivation that
throws refuses one candidate and never the run.

## The ladder, in exactly this order

| Condition       | Rung                         | Budget spent           |
| --------------- | ---------------------------- | ---------------------- |
| no key          | `floor_no_key_configured`    | 0 claims, 0 calls      |
| cap spent       | `floor_cap_exhausted`        | 0 calls                |
| already claimed | reuse the persisted finding  | 0 calls, no second row |
| call failed     | `floor_model_call_failed`    | claim consumed         |
| output invalid  | `floor_model_output_invalid` | claim consumed         |
| guard rejected  | `floor_model_text_rejected`  | claim consumed         |
| otherwise       | `model_rendered`             | claim consumed         |

One call site per rung, and the order is the contract. Three properties fall out of it
and out of nothing else:

1. **The key check precedes the claim**, so an installation with no key consumes zero
   budget. The branch selects the no-key lane; it never tries and fails.
   `deps.summariser` is `null` there and no port is reached for.
2. **The claim precedes the call**, so a failed call still consumes the cap. A project
   cannot buy unlimited retries by failing.
3. **`output_invalid` and `text_rejected` never collapse**
   (`packages/shared/src/summary/types.ts:84-99`). "The shape could not be read" and
   "the prose asserted something it may not" are different debugging signals and
   different sentences to a customer. They are two branches, in that order, reachable
   only in that order: the guard runs only over text the output schema has already
   parsed.

## The guard judges the text as it will be persisted

A gate that clears a different string from the one stored is a gate that does
nothing. So the model's prose is segmented first, the guard is handed the join of
those very sentences, and the array persisted is that same array. Split once, by the
one function whose refusal (`null`) is itself a rejection, and never re-split
downstream.

## Every degraded path still persists the finding

A missing written explanation is an absence of prose, never an absence of the finding
(SAC-6). The numbers, the surface, the class, the window and the evidence shape are
identical whichever rung applied; only the text differs, and `summary_source` says
which rung it was.

## Every exit path is terminal

`analysis_runs` carries a partial unique index on `(org, project) WHERE status =
'running'`, so a row left `running` does not merely look untidy. It makes every
future run for that project un-openable and jams the lane silently, forever. Every
path out of an opened run therefore closes it: the ordinary end, a spent cap, a
candidate the floor refused, a thrown port, and a store that stopped answering.

The only path that can leave a `running` row is a close that itself fails; that one
is logged loudly, and the repository's lease (`ANALYSIS_RUN_LEASE_MS`, 45 minutes,
deliberately shorter than the task's hourly cron) hands the lane back to a later tick
rather than leaving it jammed. The later tick closes the abandoned row `failed` and
reopens the lane, so the cost of a failed close is bounded and known: that run's own
verdict is lost, and the row reads as an abandoned run rather than as what actually
happened.

## A candidate that produced no finding is a fact the run row carries

Two candidates leave the walk with nothing written: one the surface gate refused to
transmit, one the floor could not phrase. Both are counted onto the run
(`candidates_refused`, `candidates_unrenderable`) and not merely into the process's
memory. A run in which every candidate fell out would otherwise close `completed` /
`produced_findings` / `ran_to_completion` over zero rows: "we lost some" decaying
into "we checked everything", SAC-10's own shape one level down. No floor sentence is
invented for them: nothing honest could be written, so the count is what is stored.

## The cap's exhaustion is a named state, never silence

Past the cap, candidates are still persisted (under `floor_cap_exhausted`) and the
run records `stop_reason = cap_exhausted` (SAC-10). Dropping them would make "we
stopped early" indistinguishable from "there was nothing more to find", which would
tell a founder their product is quieter than it is.

"The cap" is two ceilings: per project, and per organisation across all its projects.
Both are checked in the one claim statement and refuse with the one answer. The tick
therefore has no branch for the difference: both land on the cap rung, both render
the same sentence, and both close the run `cap_exhausted`. See
[decision 0004](0004-analysis-cap.md) for why one sentence covers two causes.

## Idempotency is structural, not remembered

Two mechanisms, neither of which is a check-then-write: `claimModelCall` is one
conditional insert against a unique `(org, project, signature)`, and `persist` is one
insert against the same tuple on `findings`. A Graphile Worker replay of this task
therefore conflicts on both, re-calls no model and mints no second finding. Because
the signature is derived from the candidate's content rather than from its position
or the tick's instant, so does a later tick looking at the same problem.

## There is no payload, and that is the validation

The task is cron-triggered. `runAnalysisTick` takes dependencies and reads no payload
by any route, so a hand-enqueued job carrying junk cannot widen anything. That is a
stronger guarantee than parsing a value cron never sends, and the same shape both
other shipped ticks use (`worker/src/index.ts` passes `_payload`). Each lane's tenant
scope comes from the lane row the source read; there is nothing a caller could supply
an organization id through even in principle.

## The vendor is unnameable here

`SessionSummariser` is a port from `@growthmind/adapters`. Neither `ai` nor
`@ai-sdk/anthropic` is imported in the tick file or anywhere in `worker/`; the
composition root selects an implementation, and the tick cannot learn its name. No
customer-facing sentence is authored in the tick either: every one comes from
`@growthmind/shared` through `renderFloorSummary`.
