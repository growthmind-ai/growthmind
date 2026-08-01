# Decision 0009: The funnel drop-off detector reads path transitions and emits one candidate per origin

**Status: Decided.** Recorded 2026-08-01, extracted verbatim-in-substance from the
file header and inline design commentary of
`packages/core/src/detect/funnel-dropoff.ts` when long-form rationale moved to docs.

**Decides:** what the `funnel_dropoff` detector operates on, what one candidate means,
and the fail direction of every choice inside it.
**Implemented by:** `packages/core/src/detect/funnel-dropoff.ts`

---

## Path transitions, not event names

The detector operates over path transitions: consecutive distinct `url_path` values in
the ordered timeline, whatever the events are named. There is no event-name literal in
the file at all, and a grep test asserts there never is.

Why: the attempt to pin the vendor's page-view event name came back failed-to-pin, so
a detector keyed on a page-view event name would be built on an unpinned assumption.
It does not need to be. The adapter reads `$pathname`/`$current_url` on every event,
so `url_path` is populated wherever the SDK sends it, regardless of event name. If a
real project turns out to populate `url_path` on nothing, the detector degrades to an
empty result with `coverage.eventsWithoutUrlPath` telling the honest story: a visible
degradation, not a silent one.

The detector also may not propose the class a clean exit would satisfy: its
`claimedClass` is constrained by `DetectorProposedClass`, and the literal for that
class appears nowhere under `src/detect/`.

## One candidate per origin

The loop originally emitted one candidate per `(origin, destination)` transition. A
review asked which of two fixes to take: carry `destination` into the candidate and
add a second serialisation version, which makes N destinations N problems; or emit one
candidate per origin, aggregating across destinations, so one stuck surface is one
problem. The second fix was taken. `DetectorCandidate` carries no destination and none
is needed: per-origin aggregation resolves both halves of the defect at once, one
identity (one `evidence_shape` per origin, closing the identity collision) and one
count whose meaning is now "left the origin without going anywhere it could have gone"
rather than "did not reach this destination".

The old per-transition meaning produced the rate-inflation half of the defect: a
healthy branching hub reported "20 of 30 did not reach here" three times over, once
per destination it never claimed.

## Three sub-rules, each pinned by a named test

The product requirements left three sub-rules open. Each is decided in the detector
and pinned by a test that names it in
`packages/core/__tests__/detect/funnel-dropoff.test.ts`, so a reader can grep the rule
and land on its proof:

- "the dropped and struggling cohorts are structurally disjoint"
- "the self-transition filter is unreachable while pathWalk collapses consecutive
  repeats"
- "an origin whose destination set is empty emits no candidate"

The first test pins a consequence of the first-visit choice rather than the choice
itself: under first-visit semantics a dropped session visited the origin exactly once,
so the dropped and struggling cohorts can never overlap. Reverse the choice and that
test is what fails.

## First-visit semantics, and the fail direction

A session's visit to the origin is its first occurrence in the ordered walk. That
maximises the window in which a session can be seen to continue, so it maximises the
continued count and minimises `dropped`. Fail direction: under-detect, the house
direction, and the direction every member of `ThresholdRuleSet` is documented in.

## Why the destination set cannot move the count

`dropped` reduces exactly to "the walk ends at the session's first visit to the
origin" (`walk.indexOf(origin) === walk.length - 1`), and the contents of the
destination set cannot change one session's verdict. The set is not supplied from
outside; `transitionsOf` builds it from the same kept walks. Take any walk holding the
origin and look at the slice after its first visit:

- if that slice is non-empty, its first entry is by construction an immediate
  successor of the origin in this very walk, hence a member of the raw destination
  set; and it differs from the origin, because `pathWalk` collapses consecutive
  repeats, so it survives the self-exclusion filter and is a member of the filtered
  set. The `.some` over the slice therefore succeeds at the first element it tests,
  whatever else the set holds;
- if that slice is empty, `.some` is false, whatever the set holds.

Enlarge the set or shrink it, the count is identical. The filter expression in the
loop should be read as this reduction, not as a lookup whose answer depends on the
set: "reaches a member of `destinations`" is true but reads as though the destination
set moves the number, and it does not. Both `purity.test.ts` and
`funnel-dropoff.test.ts` state this reduction where they justify their three-cohort
fixtures.

## The self-exclusion filter is inert, and kept anyway

The origin is not a member of its own destination set. As a statement of meaning this
is a real decision: counting a return to the origin as "going somewhere it could have
gone" would be false to the sentence the count owes a non-technical reader, "left this
page without going anywhere it could have gone".

As code, the filter is inert, and inert under any visit-selection semantics, not
merely the first-visit one. `pathWalk` pushes a path only when it differs from the
previous one, so no walk carries two adjacent equal entries; `transitionsOf` pairs
only adjacent entries. An origin can therefore never be its own immediate successor,
the filter removes nothing, and no candidate, count or fail direction changes. The
named test pins exactly this, on a fixture carrying both shapes that could produce a
self-transition: an origin-to-detour-to-origin return, and a consecutive run of raw
events on the origin.

The property belongs to `pathWalk`'s collapse and to nothing else, in particular not
to where `dropped` is measured from. Whether `dropped` runs from the origin's first
visit (as implemented, via `walk.indexOf`) or from its last does not bear on this
filter, which is inert either way. An earlier draft of the source comment claimed that
open question was the reason to keep the filter; it was wrong, and it is recorded here
so the claim is not re-derived. The filter is kept for two reasons:

- it states the meaning decision in code, where it is read and reviewed, instead of
  leaving it implicit in a property of `pathWalk` that a future edit could remove
  without anyone noticing the detector was relying on it;
- it is the guard that becomes load-bearing if that collapse changes. Relax the
  collapse and an origin-to-origin transition becomes expressible, at which point the
  filter is the only thing stopping a return to the origin from counting as somewhere
  the user "could have gone".

## The empty-destination gate

An origin whose destination set is empty emits no candidate. With nowhere reachable,
"did not go anywhere it could have gone" is vacuous, and asserting it would claim a
drop-off on every exit page in the product.

The gate is inert as code for the same reason the filter is: `transitionsOf` only ever
keys an origin that had a successor, so the raw destination set is never empty, and no
walk carries adjacent repeats, so the filter can never empty it. A terminal surface
emits nothing because it is never a key of the transition map, not because the
`continue` runs. The test pins that outcome, which is what a reader should rely on;
the gate, like the filter, states the meaning decision in code and becomes
load-bearing the moment either of those two properties changes.

## Containment before the aggregation fix

Before per-origin aggregation, the hub defect was contained only by the designed
silence of the struggle floor (`struggleMinStrugglingSessions`): a healthy hub still
produced three rate-inflated candidates, and it was only because none carried a
qualifying `struggle` signal that the gate silently downgraded and dropped them. That
containment was never about the count being right. After the aggregation, the count is
right: a healthy hub now emits at most one candidate whose `dropped` count is honest,
pinned by a hub fixture asserting a literal `toHaveLength` rather than left to the
gate's luck. Grep `funnel-dropoff.test.ts` for "a firing hub emits exactly one
candidate for the origin".

## Struggle evidence: repeated attempts only, two magnitudes

The detector emits `repeated_attempt` struggle signals only, gated inclusively on the
rule set's minimum. `backtrack` has no producer and must not gain one here: users
navigate back constantly, so a single back-navigation fires on a superset of its
target, the exact conflation this detector exists to prevent. The consuming side
closed the same door (`backtrack` is not admissible proof of anything), so "no
producer" is no longer the only guard.

The signal carries two magnitudes, and they are not interchangeable:

- `attempts` is per-session: the greatest number of separate visits any one kept
  session made to this surface. The rule-set comment "two visits is navigation; three
  is a pattern" is a statement about this number.
- `strugglingSessions` is the cohort: how many kept sessions at this origin
  individually reached that per-session minimum, counted over `basis.kept`.

The signal carries both because the maximum alone is a claim about the corpus size
rather than about the surface: it only ever rises as more sessions are read, so at
`DETECTOR_CORPUS_MAX_SESSIONS` one outlier would speak for five hundred. The proof
predicate gates on the cohort (`struggleMinStrugglingSessions`); `attempts` stays the
number a founder reads, and is honest because the signal now only exists when a real
cohort struggled.
