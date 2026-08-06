# Growthmind, Stack Implementation Plan

> What we are building Growthmind on, why each piece is locked, and the order we
> land it in. This is a plan, not a survey: every row below has an owner-facing
> definition of done. Product commitments live in
> [AGENTS.md](../AGENTS.md); this document is the technical substrate those
> commitments run on.

## The constraint every choice is made against

Growthmind's only growth channel is people running it. So every dependency is
judged on one question:

> **Can a stranger clone the repo, run `docker compose up`, and have the whole
> thing working, no signup, no API key, no free tier?**

A dependency that fails that is friction on the growth channel, no matter how
good it is. This is the same commitment as the self-host rule in
[AGENTS.md](../AGENTS.md#conventions): every feature works under `docker compose up`
with no external SaaS dependency, or it ships with a graceful absence path.

Two categories of tooling fail this test and are therefore out permanently:
**hosted-only job runners** (execution routes through a vendor's cloud) and
**source-available datastores** (a licence some companies' policies block
outright). Details in [Considered and rejected](#considered-and-rejected).

---

## The stack we are implementing

| Layer                     | Choice                                                        | Licence          |
| ------------------------- | ------------------------------------------------------------- | ---------------- |
| Runtime / package manager | **bun**                                                       | MIT              |
| Framework                 | **Next.js 16** (App Router)                                   | MIT              |
| Auth                      | **Better Auth** + organization plugin                         | MIT              |
| Database                  | **Postgres + Drizzle** (+ pgvector)                           | PostgreSQL / MIT |
| Jobs                      | **Graphile Worker**                                           | MIT              |
| UI                        | **Mantine v9**                                                | MIT              |
| Validation                | **Zod v4**                                                    | MIT              |
| AI                        | **Vercel AI SDK**; Google Gemini for session analysis         | Apache-2.0       |
| Analytics store           | **Postgres now**; ClickHouse only when event volume forces it | —                |
| Our licence               | **MIT**                                                       | —                |

Everything on that list is MIT or equivalent, installs as a package or runs as a
single container, and needs no account to run locally. That property is the point
of the list.

---

## Implementation plan

### Phase 0, The quickstart is the first thing we build

Not the last. `docker compose up` + `bun dev` is the entire README quickstart, and
CI runs it on every push so it can never silently break.

- `docker-compose.yml` with three services: `postgres` (with pgvector),
  `web`, `worker`.
- Root `package.json` with the bun workspace layout from
  [AGENTS.md](../AGENTS.md#repo-layout): `apps/web`, `packages/sdk-js`,
  `packages/db`, `packages/shared`, `worker`.
- `.env.example` covering every variable, with working local defaults for
  everything except model keys.
- A CI job that boots compose from a clean clone and asserts the app serves.

**Done when:** a clean clone with no prior setup reaches a running app in one
command, and CI proves it on every commit.

### Phase 1, Postgres + Drizzle in `packages/db`

Analytics _is_ the product. Events, funnels, cohorts, retention curves,
time-series rollups. That's window functions, `generate_series`, and lateral
joins. SQL was built for it; we're not fighting our own core loop with a document
store. Secondary wins: Postgres + Drizzle is the assumed stack in the contributor
pool we're recruiting from, pgvector means embeddings need no second datastore,
and free hosting exists on Neon/Supabase/Railway for anyone who doesn't want to
run a container.

- Drizzle schema + migrations, one migration per PR, checked in.
- pgvector enabled in the compose image from day one so no later migration has to
  introduce an extension.
- Repositories inject the org filter. See the tenant-boundary rules the
  contributor guide points at. No id-only mutation paths.

**ORM choice:** Drizzle. SQL-native, small, first-class Better Auth adapter.
Prisma would also work; Drizzle is the OSS-native pick and we're not revisiting
it.

**Done when:** `bun run db:migrate` builds the schema from empty in compose, and
`packages/db` has unit tests for every scoped-read helper.

### Phase 2, Better Auth with organizations

Auth must be self-hostable, which rules out every hosted auth vendor: a
self-hoster can't run the repo without creating an account, and no contribution
touching auth could be reviewed without the reviewer having one either. Better
Auth keeps sessions in our Postgres and its config is code. It absorbed Auth.js in
early 2026, so it's the default for new TypeScript projects rather than a bet.
Multi-tenancy, the thing hosted vendors are usually bought for, is a
first-class plugin.

- Better Auth on the Drizzle adapter (the well-trodden path, which is part of why
  Postgres came first).
- Organization plugin wired before any org-scoped feature exists, so nothing gets
  built user-scoped and retrofitted.
- Email/password + at least one OAuth provider, with OAuth optional so
  self-hosters aren't blocked on registering an app.

**Done when:** two users in one org and a user in a second org exist as test
fixtures, and cross-org reads are proven impossible by test.

### Phase 3, Graphile Worker in `worker/`

Postgres-backed, so the job queue adds no new infrastructure. One more container
in compose, and self-hosters are already running compose.

Why Graphile Worker specifically:

- **Cron with backfill.** If the worker was down at 03:00, the missed run is
  queued on recovery. Our scheduled jobs are metric rollups, and a skipped rollup
  is a permanent hole in a retention curve nobody notices for a week. This is the
  deciding factor and it is specific to what we're building.
- **Small API surface.** The main alternative (pg-boss) is solid in production
  but has a larger, more complex API.
- **Low latency.** LISTEN/NOTIFY picks jobs up in milliseconds. We won't approach
  its ~10K jobs/sec ceiling, but sub-second feedback in dev makes the pipeline
  pleasant to work on.

pg-boss remains the answer if we later need debounce or throttle-by-job-name
(it has them, Worker doesn't). Both are MIT and both use `SKIP LOCKED`; this isn't
a decision we'd regret either way.

**The operational catch, and how we handle it:** a Postgres-backed queue needs a
long-running process, so it can't live on Vercel serverless alone.

- _Self-hosters:_ one more compose service. Costs them nothing.
- _Our hosted version:_ Next.js on Vercel plus a worker container on
  Fly/Railway/Render pointed at the same Postgres. This is the only real infra we
  operate.

**Portability convention (implement this from the first job):** no queue
abstraction layer, that's over-engineering. Every handler is a plain exported
async function taking a typed payload; queue registration is a thin separate
file, and task names are exported constants, never raw strings.

```ts
// worker/tasks/rollup-daily-metrics.ts — testable, queue-agnostic
export async function rollupDailyMetrics(payload: { projectId: string; date: string }) { … }

// worker/index.ts — the only queue-aware file
worker.addJob(TASK.ROLLUP_DAILY, rollupDailyMetrics);
```

That is the actual portability: if we ever outgrow Postgres queues, one file is
rewritten and every handler plus its tests comes along untouched.

**Done when:** every handler has unit tests that never touch the queue, the task
registry is asserted complete by a test, and a cron job proves backfill on
worker restart.

### Phase 4, Mantine v9 in `apps/web`

Mantine is MIT and installs as a package, so there's no open-source objection to
answer, the only argument against it was ever ergonomic: models have seen more
shadcn, so unguided generation is more fluent there. That gap is about _unguided_
generation, which isn't how this repo is worked on. Three mitigations close it,
and all three are implementation work we do rather than assumptions we make:

1. **`AGENTS.md` pins the stack**. "Mantine v9, semantic tokens only, no raw
   CSS". The failure mode is an agent silently reaching for Tailwind classes; an
   ESLint ban on `className` string literals kills that deterministically rather
   than by review discipline.
2. **Point agents at Mantine's `llms.txt`**. The docs ship an LLM-facing
   surface, which beats generic recall.
3. **Build a `components/` primitives layer of our own**, the
   highest-leverage one. Once ~15 composed primitives exist, agents copy _our_
   patterns instead of recalling a library API, and library familiarity stops
   mattering.

Against a marginal codegen-fluency edge, batteries-included wins on the thing
that actually decides this project: sustained shipping speed over months. A
drive-by contributor building a settings page also has _fewer_ decisions to make,
not more.

**Done when:** the ESLint rule is in place and failing on violations, and the
primitives layer exists before the second page is built.

### Phase 5, Own the event pipeline in Postgres

`packages/sdk-js` captures, masks, and excludes; the pipeline stores and rolls up
in Postgres. We do **not** self-host PostHog for the analytics layer. It drags in
ClickHouse, Kafka, and Redis, which is a heavy `docker compose` for a v1 and
breaks the Phase 0 promise. Own the pipeline in Postgres first; split the event
store out to ClickHouse when volume actually forces it, behind the same
repository interfaces.

**Done when:** ingestion, rollups, and finding derivation all run on Postgres
alone in the default compose stack.

---

## Standing rules this plan creates

**Licence check before a dependency lands, not after.** The 2024–2026 trend is
MIT/Apache dependencies quietly relicensing to SSPL/BSL/Elastic. Read the
`LICENSE` file of every infra-layer dependency in the PR that adds it. Current
traps and their escapes:

| Trap            | Escape                               |
| --------------- | ------------------------------------ |
| Redis           | Valkey                               |
| Elasticsearch   | OpenSearch / Meilisearch / Typesense |
| Sentry (BSL)    | GlitchTip, or accept the SaaS        |
| Terraform (BSL) | OpenTofu                             |

**Our licence stays MIT.** Apache-2.0 would add an explicit patent grant if we
ever want it. AGPL is off the table: it suppresses adoption at exactly the stage
we need adoption, and adoption is the strategy.

**Every new dependency answers the compose question in its PR body.** One line:
does a stranger still get a working app in one command?

**Lint is type-aware, and the rules it does not enforce are written down.**
`bun run lint` runs oxlint with `options.typeAware` on, which needs
`oxlint-tsgolint` (installed as a dev dependency) and resolves types through
TypeScript 7. It costs about 4 seconds against 0.4 for the syntax-only pass —
worth it for one rule alone, `no-floating-promises`, which catches the
un-awaited promise that is the most common defect in machine-written code here.
`__tests__/toolchain.test.ts` asserts the flag, the dependency, and the binary
all still exist, because losing any one of them downgrades the gate silently
rather than failing it.

Ten type-aware rules are switched **off** in `.oxlintrc.json` rather than
enforced, and this is the record of why. They are all real, and none of them
is disabled because it was wrong:

| Rule(s)                                                                                                                                                                                                         | Findings today | Why deferred                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no-unsafe-type-assertion`, `no-unnecessary-type-assertion`, `no-unnecessary-type-conversion`, `no-unnecessary-boolean-literal-compare`, `no-unnecessary-template-expression`, `no-unnecessary-type-parameters` | 165            | Almost entirely test fixtures asserting a narrow type onto a builder's return. A codebase-wide cleanup, not something to smuggle into an unrelated PR.                                                                                             |
| `await-thenable`                                                                                                                                                                                                | 15             | Every site is a test awaiting a synchronous fake. The fix is the fixture's type, and removing an `await` where the real collaborator IS async would hide an ordering bug — so each one needs reading, not a sweep.                                 |
| `consistent-return`                                                                                                                                                                                             | 10             | Exhaustive switches that fall through to an implicit `undefined`, four of them in `packages/core/src/evidence/predicates.ts`. Making the impossible branch throw is a behaviour change on core logic and belongs in its own PR with its own tests. |
| `no-misused-spread`                                                                                                                                                                                             | 3              | The source scanners spread a string into code points and then index it against `.length` in UTF-16 units. The rule is right; fixing it means rewriting the scanners.                                                                               |
| `no-redundant-type-constituents`                                                                                                                                                                                | 1              | One union in a sign-up form.                                                                                                                                                                                                                       |

To see the current backlog for any of them:

```bash
bunx oxlint --type-aware -D typescript/consistent-return -D typescript/await-thenable
```

A rule leaves that table by having its findings fixed and its entry in
`.oxlintrc.json` deleted, not by the table growing a new excuse.

---

## Considered and rejected

Kept here so these don't get re-litigated, and so a contributor proposing one can
see the reasoning rather than a bare "no".

| Rejected                                       | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hosted auth vendors** (PropelAuth, Clerk)    | Paid hosted service. Self-hosters can't run the repo, and contributors can't review auth changes, without an account. Hard blocker.                                                                                                                                                                                                                                                                                                                            |
| **NextAuth / Auth.js**                         | Maintenance-only since Better Auth absorbed it in early 2026 — security patches, no new features.                                                                                                                                                                                                                                                                                                                                                              |
| **MongoDB**                                    | Wrong shape for a product whose core loop is funnels, cohorts, and time-series rollups. Also SSPL: source-available, not OSI-approved. It does **not** legally infect our app (SSPL only bites if you offer MongoDB-as-a-service — we shouldn't repeat the scare version), but it's a real adoption tax, since some companies' licence policies block SSPL dependencies outright. In a project pitched as fully open source, that's an argument we don't need. |
| **Inngest**                                    | No self-hosting as of 2026. Every function execution routes through their cloud, so a self-hoster's job payloads leave their infrastructure and the repo doesn't run without an account. Disqualifying.                                                                                                                                                                                                                                                        |
| **Trigger.dev v3**                             | Effectively EOL — v4.5.1+ rejects v3 triggers and deploys outright.                                                                                                                                                                                                                                                                                                                                                                                            |
| **Trigger.dev v4**                             | Self-hosting is Postgres + Redis + ClickHouse + s2-lite + webapp, docs ask 8+ GB RAM minimum. That's a self-hoster provisioning a server before they can see the product work — the same class of blocker as Inngest, just self-inflicted. Right tool for a company running heavy async pipelines; wrong tool for a v1 open-source product.                                                                                                                    |
| **shadcn/ui**                                  | Only advantage over Mantine is model training-data density, which the Phase 4 mitigations close. Costs us shipping speed.                                                                                                                                                                                                                                                                                                                                      |
| **Self-hosted PostHog as the analytics layer** | Drags in ClickHouse, Kafka, Redis. Breaks the one-command promise for a v1.                                                                                                                                                                                                                                                                                                                                                                                    |
| **pnpm**                                       | Fine choice generally, and the OSS default for monorepos — but this project standardised on bun, which covers the package manager, the test runner, and the script runner in one tool. One toolchain beats a marginal ecosystem-familiarity edge.                                                                                                                                                                                                              |
| **A queue abstraction layer**                  | Over-engineering. The handler-purity convention in Phase 3 buys the same portability for none of the cost.                                                                                                                                                                                                                                                                                                                                                     |

---

## Provenance

Stack comparisons drawn from public 2026 write-ups on Better Auth vs
Clerk vs NextAuth, MongoDB's licence position and the FerretDB clash, the
2024–2026 licence-change wave, Inngest and Trigger.dev alternatives and
self-hosting requirements, the pg-boss vs Graphile Worker comparison, and Mantine
vs shadcn/ui. Verified against each project's own docs and `LICENSE` file as of
July 2026, re-verify before citing any of it in a decision, since licences are
exactly the thing that changes.
