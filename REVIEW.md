# Landing PRs: what review catches here

[CONTRIBUTING.md](CONTRIBUTING.md) tells you how to open a pull request. This
file tells you what gets one sent back.

It is distilled from this repository's own history — every merged PR so far,
plus the incidents recorded in the code comments, which is why so many entries
below cite a file. Nothing here is a style preference. Each one is a class of
change that passed typecheck, passed lint, passed its own tests, and was still
wrong.

**If you are a coding agent, read this before you write, not after.** Most of
these failures are invisible to the gates: the code runs, the tests are green,
and the defect is that the green does not mean what it appears to mean.

---

## The one that outranks everything

The commitments in [AGENTS.md](AGENTS.md) are the contract. A PR that breaks
one is declined regardless of code quality, and [GOVERNANCE.md](GOVERNANCE.md)
explains who owns them. Argue the commitment in an issue _before_ writing the
code — not in the PR that breaks it.

## Tests

**Pure logic ships with a test.** Extractors, scorers, resolvers, diff
utilities, renderers. Tests live in `__tests__/` beside the code and run with
`bun test`. No exceptions negotiated in review.

**Test the boundary you actually cross, with the real thing on the other side
of it.** The worker once crashed on boot because a task name used a dot
separator and Graphile Worker's crontab parser accepts only letters, digits,
colon, slash, underscore and hyphen. Every unit test passed: nothing below the
crontab string had ever been fed to the real parser
([worker/src/task-names.ts](worker/src/task-names.ts)). A test that mocks the
boundary proves your mock's behaviour, not the boundary's.

**Drive the real consumer entry point, not the pieces either side of it.** A
producer test plus a consumer test does not prove the wire between them (D11) —
that is why the delivery lane is a plain exported async function with no queue
types in its signature, so the whole lane runs end to end with fakes
([worker/src/tasks/delivery-tick.ts](worker/src/tasks/delivery-tick.ts)).

**Fakes fail loudly.** A fake whose unused methods return `undefined` lets a
code path that should never have been taken pass silently. The PostHog fake
throws from the methods the identity resolver must not reach
([packages/adapters/\_\_tests\_\_/helpers/fakes.ts](packages/adapters/__tests__/helpers/fakes.ts)).

**When two facts are different, assert them as a pair.** "We looked and your
product was quiet" and "we have not looked yet" are different statements about
a customer's product, and a future refactor that collapses them onto one member
must fail a test rather than quietly tell a founder their product is quieter
than it is
([worker/\_\_tests\_\_/tasks/analysis-tick.test.ts](worker/__tests__/tasks/analysis-tick.test.ts)).

**Name the test after the invariant.** `no-direct-zod`,
`cross-tenant-real-keys`, `wire-constants`, `refusal-identity-guard`. When one
fails, the name says which architectural promise broke — not which function
returned the wrong number.

**A test that only proves the handler does not prove the credential.** The
cross-tenant proof seeds two real organisations on one database, mints a real
API key in each, and drives the real handler over it. The fake-credential
version of that test already passed
([apps/web/\_\_tests\_\_/mcp/cross-tenant-real-keys.test.ts](apps/web/__tests__/mcp/cross-tenant-real-keys.test.ts)).

## Tenancy and scope (D2, D7)

- Reads and writes go request → tenant context → service → repository. A
  hand-written aggregation, a raw SQL query, or a client-supplied id that skips
  that flow needs its own `organization_id` filter, and review will ask for the
  proof that cross-org access is impossible.
- A system/background actor is a **closed union**, never a loose string. A
  generic `SYSTEM_ACTOR_ID` holding one specific value invites the next
  background writer to stamp its audit rows as the wrong actor — correctly
  typed, silently wrong
  ([packages/db/src/system/system-actor.ts](packages/db/src/system/system-actor.ts)).
- Whatever a scoped read filters by, the write path must stamp. A filter on a
  column nothing sets matches zero rows and reads as "no data", not as an
  error.
- Org-scoped effects have an audience. If a notification goes to one user
  inside an org-scoped change, say in the PR body that the narrowing is
  deliberate (D1).

## Failure, and saying so (D8)

- **Every start has a terminal state.** A path that can exit without writing
  `completed` or `failed` leaves a job stuck "running" in front of a customer
  forever. The session-source poll fails closed _and_ still writes and finishes
  its run row, because a connection that silently stops polling is exactly the
  stuck state the transparency rule forbids
  ([worker/src/tasks/session-source-poll.ts](worker/src/tasks/session-source-poll.ts)).
- **A failing side effect must not kill the main flow.** Slack post,
  notification, cleanup — independent try/catch, logged, never propagated into
  the caller's result.
- **No silent success.** The env loader once failed with no error at all: every
  strictly-required variable had a dev default, so the app booted fine and only
  the optional ones went missing
  ([apps/web/instrumentation.ts](apps/web/instrumentation.ts)). If a degraded
  mode is acceptable, it must be visible.
- **A cleanup that can delete the thing the main flow just wrote is a data-loss
  bug**, not a tidy-up.

## Deterministic gates fail in a direction — name it (D10)

Any keyword rule, bot filter, threshold, or classifier _will_ miss real inputs.
Review does not ask whether it misses; it asks which way it fails and whether
that direction is safe. The Slack error mapper defaults unclassified codes to
the retryable arm and says why in the comment: a terminal default strands a
finding a second attempt would have delivered, while a retryable default costs
a bounded number of doomed retries
([packages/adapters/src/slack/errors.ts](packages/adapters/src/slack/errors.ts)).
An exclusion predicate additionally needs a near-miss fixture proving it does
not fire on its conflation neighbour.

## Data shape (D5)

Production contains every shape ever written, not the shape today's schema
declares — jsonb columns especially. Coerce at the DTO boundary; do not trust
the declared type of a persisted row. Model output is external data too:
validate it with the Zod schema before persisting, never because you asked for
that schema.

Boundary cases are part of the change, not a follow-up: zero rows, one row, a
zero denominator, first-write vs update, a session with two events.

## Identity and dedup (D12)

A deterministic id is exactly as stable as its least stable input. If a dedup
key, signature, or suppression lookup takes a derived input, the PR must name
what keeps that input stable across rename, refactor, and re-derivation — or
carry the ancestry mapping that survives it. "Same input, same hash" proves
nothing; the fixture has to survive the churn event.

## Strings that should have been types (D9)

Task names are exported constants in
[worker/src/task-names.ts](worker/src/task-names.ts) and the registry test
asserts queue and handler stay in step. Zod schemas in `packages/shared` are
the single source of truth for shapes — the object that validates a call is the
object that renders the advertised schema, so there is no wire between a
producer and a consumer to sever. If a wrong value could be a compile error
instead of a runtime one, review will ask for that.

## Self-host is not a feature flag

Every change works under `docker compose up` from a clean clone, with no
external SaaS, or ships with a graceful absence path. A PR that adds a
dependency or a service answers the compose question in its body: does a
stranger still get a working app in one command?

## Customer-facing strings

Plain English, no product jargon, and counts always carry denominators
([AGENTS.md](AGENTS.md)). "3 of 47 sessions" is reviewable; "3 sessions" is not.
Never let an upstream vendor's error text reach a customer-visible field
verbatim — it carries ids, and `z.string()` accepts all of them
([packages/adapters/src/slack/errors.ts](packages/adapters/src/slack/errors.ts)).

## Comments

About half the lines in `packages/` and `worker/` are comments, and that is
deliberate. A comment states the reasoning in full prose; the short identifier
(`D7`, `AD-20`, `SAC-10`) only records where the decision was ratified —
[docs/reliability-checklist.md](docs/reliability-checklist.md) decodes them. Two rules:

- **Deleting the awkward shape a comment explains is the most common bad PR
  here.** If a comment says a shape is load-bearing, the simplification needs
  to answer the comment first.
- **A comment whose tag is doing work the prose is not is a documentation
  bug.** Open an issue.

## Fix the class, not the instance

If review finds a bug that has siblings elsewhere in the codebase, the PR is
expected to fix all of them. A pattern fixed in one file and left in four
others gets sent back — the next person to hit it has no way to know it was
already understood once.

## Before you open it

```bash
bun run check   # typecheck + lint + format + tests + production build
```

CI runs that same gate plus a `docker compose up` boot from a clean clone. A
green local `check` and a red CI means you skipped the compose question.
