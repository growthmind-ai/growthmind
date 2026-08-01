---
name: writing-a-unit-test
description: Write a test that would actually have caught the bug — invariant naming, loud fakes, real entry points, paired assertions, and boundary fixtures. Use whenever adding or changing tests.
---

# Writing a unit test

Tests run with `bun test` (the Bun runner — never Jest, never Vitest) and live
in `__tests__/` directories beside the code they cover. Pure logic —
extractors, scorers, resolvers, diff utilities, renderers — does not ship
without one.

That much is convention. The rest of this file is about writing a test that
fails when the behaviour breaks, rather than one that passes forever.

## Name the test after the invariant

`no-direct-zod`, `cross-tenant-real-keys`, `wire-constants`,
`refusal-identity-guard`. When one of those fails, the name says which
architectural promise broke. `handles edge case` says nothing, and the next
person deletes it during a refactor because they cannot tell what it protects.

Test names in this repo are treated as architectural invariants. Write the
sentence you would want to read in a CI failure six months from now.

## Fakes must fail loudly

A fake whose unused methods return `undefined` lets a code path that should
never have been taken pass silently. Make the methods that must not be reached
**throw**, so a wrong path fails visibly:
[packages/adapters/\_\_tests\_\_/helpers/fakes.ts](../../../packages/adapters/__tests__/helpers/fakes.ts).

## Drive the real entry point

A producer test plus a consumer test does not prove the wire between them
(D11). If surface A computes a value for surface B, at least one test calls
**B's real entry point** and asserts the effect fired. The worker lane is
structured specifically to make this possible: the task function takes ports
and has no queue types in its signature
([worker/src/tasks/delivery-tick.ts](../../../worker/src/tasks/delivery-tick.ts)).

The strongest version: call the consumer with the producer _not_ having run,
and assert the effect still happens (self-derivation) or is explicitly absent —
never a silent no-op.

## Assert distinct facts as a pair

"We looked and your product was quiet" and "we have not looked yet" are
different statements about a customer's product. Both are asserted together, so
a later change that collapses them onto one member fails loudly instead of
quietly telling a founder their product is quieter than it is
([worker/\_\_tests\_\_/tasks/analysis-tick.test.ts](../../../worker/__tests__/tasks/analysis-tick.test.ts)).

Any time two states are _allowed_ to look similar in the UI but mean different
things, pin both.

## Test the boundary with the real thing behind it

Mocking the boundary proves your mock. The worker once crashed on boot over a
crontab separator that no test had ever fed to the real parser
([worker/src/task-names.ts](../../../worker/src/task-names.ts)). If a string,
schema, or payload crosses into a library, drive at least one test through that
library.

## Fixtures that cover what production holds

- `null`, `undefined`, empty array, empty string, missing field.
- Sparse: a session with two events, a funnel with one step, a finding with no
  evidence.
- Boundary: 0%, 100%, a zero denominator, a single-item array, first-write vs
  update.
- **Legacy shapes.** Production contains every shape ever written, not the one
  the schema declares today. A DTO test gets a minimal row _and_ a legacy-shaped
  row (D5).
- For a deterministic id or dedup key: compute it, apply the realistic churn
  (rename the file, re-derive the surface, bump the serialisation), recompute,
  and assert the identity survived. "Same input twice" proves nothing (D12).

## Concurrency and delivery

- Two writers on one row: simulate both against the fake repository and assert
  no lost update (D6).
- Handler invoked twice with the same payload: assert one write and one send
  (D4).
- Side effect throws: assert the main operation still succeeds and the error is
  logged (D8).

## Before you call it covered

Ask the one-line question from [edge-sweep](../edge-sweep/SKILL.md): who else
hits this, at what scope, with how many rows, delivered how, in what shape —
and does a failing side effect still let the main flow succeed? Any cell you
did not check is not covered, whatever the coverage number says.
