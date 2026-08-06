# Growthmind, contributor guide (humans and coding agents)

Growthmind ([growthmind.ai](https://growthmind.ai)) is the product growth loop for people building with a coding assistant: it challenges the brief before the code exists, simulates the audience before you ship, and checks what really happened after. [README.md](README.md) is the product; this file is the contract for changing the code. Growthmind is the only product that enables you to build fast with your customers in mind.

It lives at `AGENTS.md` because that is the filename coding agents look for without being configured. [CLAUDE.md](CLAUDE.md) and [.github/copilot-instructions.md](.github/copilot-instructions.md) import or point here they are not second copies.

## What Growthmind is

**The product growth hire you make years early.** It is for anyone building products with a coding assistant who has not hired a product growth person, and needs the judgment they are missing.

What it is aiming at, since it changes what counts as a good change here: making every product one people come back to. Not more sign-ups, and not a better funnel chart the product itself, made worth returning to, because that is the only growth that lasts. Building got cheap enough that anyone can ship. The judgment about whether a thing was worth shipping did not get cheap with it, and Growthmind exists to make that judgment cheap too. A feature that adds a number to a chart without changing what gets built next is off-target here even when it works.

It is a **loop, not a tool**, and that distinction decides what belongs in this codebase. Everyone else sells a single link observation, or diagnosis, or measurement, or a patch and hands you the job of joining them up. A finding that does not become a build is a report. A build that is not measured is a guess. A measurement that does not feed the next brief is a fact nobody uses. A change that leaves the chain open rather than closing it is the wrong change here, however well it is built.

Growthmind connects once to the customer's repo, coding assistant and analytics, and then stays connected. It keeps one model of their product, the people it is for, and everything that has been tried, and updates that model as it learns. It shows up in three places:

1. **At brief time, inside the coding assistant** checking what is about to be built against the people it is for, and giving the assistant the patterns and context to build it well.
2. **Before ship** walking a simulated group of the people the product is for through the preview, then reporting where they stall, why, and what to change.
3. **After launch, in the channel the customer already uses** what real users did against what Growthmind predicted, what is working, what is not, and the fix written up in enough detail for the assistant to pick it up.

## The commitments a PR is judged against

These are not style preferences. **A PR that breaks one is declined regardless of how good the code is.** If the task you were given requires breaking one, say so and stop. The route to changing a commitment is an issue, before the code.

- **Growthmind never writes to a customer's repo.** Read access only. It recommends, describes and judges; their assistant builds. Nothing of ours in their commit history.
- **Nothing the customer has to remember to check.** A dashboard is not a way of delivering something, and neither is a report someone has to open. Findings are pushed to a channel they already use.
- **It predicts, then marks its own homework.** A forecast is recorded along with how it will be judged, decided in advance, and scored later against what real users actually did including when it was wrong. A path that produces a claim nobody can score afterwards is unfinished.
- **Every loop writes back.** What a cycle learned lands in the model, so the next brief starts sharper than the last.
- **Every number says out of how many.** "3 of 47 sessions", never "3 sessions". A claim states what was seen and how many chances there were to see it.
- **No personal data in the event stream.** Ids are derived the same way every time, and the customer's own traffic is excluded.
- **Plain English in anything a customer reads.** No product jargon, and never an error message from another vendor copied out word for word those carry internal ids.
- **Self-hosting is not the lesser option.** Every feature works under `docker compose up` from a clean clone with no outside services, or fails softly and says so when one is missing.

The full statement of what Growthmind is lives in the maintainers' company alignment document, which is private. Where this section and that document disagree, that document wins and this section is the bug.

## Read before you write

| File                                                           | What it gives you                                                                                               |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [REVIEW.md](REVIEW.md)                                         | What gets a PR sent back. Every entry passed typecheck, passed lint, passed its own tests, and was still wrong. |
| [.agents/README.md](.agents/README.md)                         | Procedures for jobs with a right order: worker tasks, API routes, tests, verifying a change, edge sweeps.       |
| [docs/architecture.md](docs/architecture.md)                   | Which subsystem enforces which commitment above. Read it before adding one.                                     |
| [docs/reliability-checklist.md](docs/reliability-checklist.md) | How this kind of system actually breaks in production.                                                          |

`.agents/skills/*/SKILL.md` are plain Markdown, tied to no particular tool, and nothing loads them for you. Open the one that matches the job before you start it.

## Commands

```bash
docker compose up    # full stack from a clean clone: postgres + web + worker
bun install          # deps; also wires .githooks via core.hooksPath
bun run dev          # Next.js dev server (:3000)
bun run dev:worker   # Graphile Worker, second terminal
bun run typecheck    # tsc --noEmit, every workspace plus scripts/
bun run lint         # oxlint
bun test             # bun's test runner  never Jest, never Vitest
bun run build        # production build
bun run check        # typecheck + lint + format:check + test + build
bun run db:generate  # drizzle migration from a schema change
bun run db:migrate   # apply migrations
```

**bun, everywhere.** `npm`, `yarn`, `pnpm` and `npx` write a second lockfile that CI's `bun install --frozen-lockfile` rejects. Run `bun run typecheck`, not a bare `tsc` the script covers every workspace, while a direct `tsc` covers one and gives you a green result CI will not reproduce.

No `.env` is needed locally: every variable required to boot has a development default, and `docker-compose.yml` bakes in the same ones. [.env.example](.env.example) documents each variable and what happens when it is absent.

Auth schema changes: edit `apps/web/lib/auth.ts`, then run `bun run db:generate:auth` followed by `bun run db:generate`.

## Before you open a PR

`bun run check` is the gate, and it is not skippable. Do not report a change as working on the strength of a typecheck.

CI runs three gates `bun run check` does not:

- **`bun run db:generate` must leave the tree clean.** A schema edit with no generated migration typechecks, lints, and passes every test the code and the migrations only disagree at runtime, against a real database.
- **`__tests__/undeclared-dependencies.test.ts`.** An import of a package the workspace does not declare resolves fine against a laptop's accumulated `node_modules` and fails here.
- **`docker compose up` from a clean clone, then a probe of `/api/health`.** A green local `check` and a red CI means you skipped the compose question.

A `pre-push` hook ([.githooks/pre-push](.githooks/pre-push)) runs typecheck + lint + format:check, about nine seconds. `bun test` and `bun run build` are minutes, so they stay in CI. Bypass with `git push --no-verify` when you want CI to be the judge.

Then run [.agents/skills/verify-a-change](.agents/skills/verify-a-change/SKILL.md). Passing tests do not prove your edit reached the running process, and in this repo that gap has produced a worker that crashed on boot and an env loader that failed in silence.

## Stack

- **Runtime**: bun (package manager and script runner), Node ≥ 22
- **Web**: Next.js 16 App Router, React 19, TypeScript strict, Mantine v9
- **Data**: Postgres 17 + Drizzle ORM; pgvector enabled from migration 0000
- **Auth**: Better Auth
- **Jobs**: Graphile Worker (Postgres-backed; cron with backfill)
- **Validation**: Zod v4, schemas in `packages/shared` the single source of truth for shapes
- **AI**: Vercel AI SDK. The model is configuration, never written into application code `packages/adapters/src/model/` owns it

Exact versions live in the workspace `package.json` files. Read them there rather than trusting a number in this file.

## Repo layout

```
apps/web/           # Next.js app (findings, settings, billing) and API routes
packages/core/      # detectors, scoring, analysis logic
packages/adapters/  # Slack, model provider, session sources
packages/db/        # Drizzle schema, migrations, repositories, generated auth schema
packages/shared/    # Zod schemas, shared types, env validation
packages/sdk-js/    # the event package  capture, masking, exclusions
worker/             # Graphile Worker process (analysis pipeline, batch polling)
docs/               # shipped documentation: architecture, evidence standard, telemetry
.agents/skills/     # procedures for jobs with a right order (any agent)
```

## Conventions

- **Pure logic ships with a test.** Extractors, scorers, resolvers, diff utilities. Tests live in `__tests__/` beside the code they cover.
- **Name a test after the rule it protects**, not the function it calls: `no-direct-zod`, `cross-tenant-real-keys`, `wire-constants`. When one fails, the name says which promise about the design just broke.
- **Never hand-edit a generated file.** `packages/db/src/schema/auth.ts` comes from `apps/web/lib/auth.ts` via `bun run db:generate:auth`; migrations under `packages/db/drizzle/` come from `bun run db:generate`; `bun.lock` comes from `bun install`. A hand-edit succeeds, passes, and is wiped out by the next person who runs the generator.
- **Worker task names are exported constants** in `worker/src/task-names.ts`, never raw strings. The registry test enforces it.
- **Keep `page.tsx` files server components.** Client logic lives in separate `"use client"` components.

## Comments

Comments here explain **why**, not what: the reasoning the next reader could not recover from the code alone. Why a check sits before the thing it protects, which two states may never collapse into one, what a plausible-looking simplification would break.

- Short, plain prose. No section banners, ASCII rules, or box-drawing.
- No shouting. Emphasis is the sentence, not capital letters.
- No shorthand a reader outside the project cannot resolve. Cite a file, a test, or a doc under `docs/` instead.
- Long-form design rationale belongs in `docs/`, where it gets reviewed and versioned. A comment links to it rather than restating it.

## If you are a coding agent

Everything above applies to you. These two are addressed to you specifically, because they are how agent work goes wrong here while looking fine.

1. **Say what you did not verify.** A change you could not drive no credential, no Slack workspace, no data is a change to flag, not to describe as done. Overclaiming is the single most expensive thing an agent does in this repository, because the human stops checking.
2. **Disclose that you were used.** See the AI-assisted contributions section of [CONTRIBUTING.md](CONTRIBUTING.md). The person opening the PR owns everything in it either way.

## Local working directories

`.claude/`, `.ai/` and `local/` are gitignored. Do not commit them or reference their contents in code. `local/` is where a maintainer or contributor keeps private notes and drafts beside the code without any risk of publishing them. If the agent you use keeps its own working directory, put it under `local/` or add it to `.gitignore` no contributor's tooling belongs in this repo's history.

## Pointing your tool at this file

If your tool reads some other filename, add a pointer file rather than a copy. A second copy of these rules drifts from the first within a week.

For rules that apply to one part of the tree only, add a nested `AGENTS.md` in that directory instead of growing this one. Agents read the nearest file in the directory tree, so the closest one wins.
