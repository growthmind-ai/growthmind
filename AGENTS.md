# Growthmind, contributor guide (humans and coding agents)

Growthmind ([growthmind.ai](https://growthmind.ai)) is the product growth loop for people building with a coding assistant: it challenges the brief before the code exists, simulates the audience before you ship, and checks what really happened after. [README.md](README.md) is the product; this file is the contract for changing the code.

It lives at `AGENTS.md` because that is the filename coding agents look for without being configured.

## What Growthmind is

**The product growth hire you make years early.** It is for anyone building products with a coding assistant who has not hired a product growth person, and needs the judgment they are missing.

What it is aiming at, since it changes what counts as a good change here: making every product one people come back to. Not more sign-ups, and not a better funnel chart. The product itself, made worth returning to, because that is the only growth that lasts. Building got cheap enough that anyone can ship. The judgment about whether a thing was worth shipping did not get cheap with it, and Growthmind exists to make that judgment cheap too. A feature that adds a number to a chart without changing what gets built next is off-target here even when it works.

It is a **loop, not a tool**, and that distinction decides what belongs in this codebase. A finding that does not become a build is a report. A build that is not measured is a guess. A measurement that does not feed the next brief is a fact nobody uses. A change that leaves the chain open rather than closing it is the wrong change here, however well it is built.

Growthmind connects once to the customer's repo, coding assistant and analytics, and then stays connected. It keeps one model of their product, the people it is for, and everything that has been tried, and updates that model as it learns. It shows up in three places:

1. **At brief time, inside the coding assistant**: checking what is about to be built against the people it is for, and giving the assistant the patterns and context to build it well.
2. **Before ship**: walking a simulated group of the people the product is for through the preview, then reporting where they stall, why, and what to change.
3. **After launch, in the channel the customer already uses**: what real users did against what Growthmind predicted, what is working, what is not, and the fix written up in enough detail for the assistant to pick it up.

## The commitments a PR is judged against

These are not style preferences. **A PR that breaks one is declined regardless of how good the code is.** If the task you were given requires breaking one, say so and stop. The route to changing a commitment is an issue, before the code.

- **Growthmind never writes to a customer's repo.** Read access only. It recommends, describes and judges; their assistant builds. Nothing of ours in their commit history.
- **Nothing the customer has to remember to check.** A dashboard is not a way of delivering something, and neither is a report someone has to open. Findings are pushed to a channel they already use.
- **It predicts, then marks its own homework.** A forecast is recorded along with how it will be judged, decided in advance, and scored later against what real users actually did, including when it was wrong. A path that produces a claim nobody can score afterwards is unfinished.
- **Every loop writes back.** What a cycle learned lands in the model, so the next brief starts sharper than the last.
- **Every number says out of how many.** "3 of 47 sessions", never "3 sessions". A claim states what was seen and how many chances there were to see it.
- **No personal data in the event stream.** Ids are derived the same way every time, and the customer's own traffic is excluded.
- **Plain English in anything a customer reads.** No product jargon, and never an error message from another vendor copied out word for word, since those carry internal ids.
- **Self-hosting is not the lesser option.** Every feature works under `docker compose up` from a clean clone with no outside services, or fails softly and says so when one is missing.

This list can fall behind what the product has become. If a task you were given only makes sense when one of these is false, that is a bug in this file: raise an issue and stop, rather than editing the commitment to match the task.

## Read before you write

| File                                                           | What it gives you                                                                                                                                         |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [REVIEW.md](REVIEW.md)                                         | What gets a PR sent back. Every entry passed typecheck, passed lint, passed its own tests, and was still wrong.                                           |
| [.agents/README.md](.agents/README.md)                         | Procedures for jobs with a right order: worker tasks, API routes, tests, opening a PR, verifying a change. One directory per job under `.agents/skills/`. |
| [docs/architecture.md](docs/architecture.md)                   | Which subsystem enforces which commitment above, and the repo layout with what may depend on what (§11).                                                  |
| [docs/stack.md](docs/stack.md)                                 | Why each dependency was chosen, and which were rejected, so they are not re-litigated.                                                                    |
| [docs/reliability-checklist.md](docs/reliability-checklist.md) | How this kind of system actually breaks in production.                                                                                                    |
| [CONTRIBUTING.md](CONTRIBUTING.md)                             | Commit messages, the licence check on a new dependency, and what a PR has to disclose.                                                                    |

`.agents/skills/*/SKILL.md` are plain Markdown, tied to no particular tool, and nothing loads them for you. Open the one that matches the job before you start it.

That is the reason this file is short. Everything a job announces — you are adding a worker task, you are writing a test, you are about to push — lives in the skill for that job. What is left here is what you could not know to go and look up.

## Commands

```bash
docker compose up    # full stack from a clean clone: postgres + web + worker
bun install          # deps; also wires .githooks via core.hooksPath
bun run dev          # Next.js dev server (:3000)
bun run dev:worker   # Graphile Worker, second terminal
bun run typecheck    # tsc --noEmit, every workspace plus scripts/
bun run lint         # oxlint
bun test             # bun's test runner, never Jest, never Vitest
bun run build        # production build
bun run check        # typecheck + lint + format:check + test + build
bun run db:generate  # drizzle migration from a schema change
bun run db:migrate   # apply migrations
```

**bun, everywhere.** `npm`, `yarn`, `pnpm` and `npx` write a second lockfile that CI's `bun install --frozen-lockfile` rejects. Run `bun run typecheck`, not a bare `tsc`. The script covers every workspace, while a direct `tsc` covers one and gives you a green result CI will not reproduce.

No `.env` is needed locally: every variable required to boot has a development default, and `docker-compose.yml` bakes in the same ones. [.env.example](.env.example) documents each variable and what happens when it is absent.

## Before you open a PR

`bun run check` is the gate, and it is not skippable. Do not report a change as working on the strength of a typecheck.

Three further gates run in CI and not in `check`, one of them a schema edit whose missing migration only disagrees with the code at runtime. [.agents/skills/opening-a-pr](.agents/skills/opening-a-pr/SKILL.md) is the procedure for all three, and it ends at [verify-a-change](.agents/skills/verify-a-change/SKILL.md), which is what proves the edit reached the running process.

## Stack

bun (package manager, test runner and script runner) on Node ≥ 22; Next.js 16 App Router, React 19, TypeScript strict, Mantine v9; Postgres 17 with Drizzle and pgvector from migration 0000; Better Auth; Graphile Worker; Zod v4; the Vercel AI SDK.

Two of those carry a rule rather than a preference. Zod schemas in `packages/shared` are the single source of truth for shapes. The model is configuration and never appears in application code, because `packages/adapters/src/model/` owns it. [docs/stack.md](docs/stack.md) is why each was chosen; the workspace `package.json` files are the versions.

## Repo layout

`apps/web` (Next.js app and API routes), `packages/core` (detectors, scoring, analysis), `packages/adapters` (Slack, model provider, session sources), `packages/db` (Drizzle schema, migrations, repositories), `packages/shared` (Zod schemas, shared types, env validation), `packages/sdk-js` (the event package: capture, masking, exclusions), `worker` (the Graphile Worker process). `docs/` is shipped documentation and public.

## Conventions

- **Never hand-edit a generated file.** `packages/db/src/schema/auth.ts` comes from `apps/web/lib/auth.ts` via `bun run db:generate:auth`; migrations under `packages/db/drizzle/` come from `bun run db:generate`; `bun.lock` comes from `bun install`. A hand-edit succeeds, passes, and is wiped out by the next person who runs the generator.
- **Pure logic ships with a test**, in `__tests__/` beside the code it covers, named after the rule it protects rather than the function it calls.
- **Comments explain why, not what**: the reasoning the next reader could not recover from the code alone. Short plain prose, no section banners, no capital-letter emphasis, no shorthand a reader outside the project cannot resolve. Long-form design rationale belongs in `docs/`, and a comment links to it rather than restating it.

A convention that belongs to one job lives with that job instead of here: task-name constants in [adding-a-worker-task](.agents/skills/adding-a-worker-task/SKILL.md), tenant scope and schema ownership in [adding-an-api-route](.agents/skills/adding-an-api-route/SKILL.md), loud fakes and boundary fixtures in [writing-a-unit-test](.agents/skills/writing-a-unit-test/SKILL.md), the client/server boundary in [apps/web/AGENTS.md](apps/web/AGENTS.md).

## If you are a coding agent

Everything above applies to you. These two are addressed to you specifically, because they are how agent work goes wrong here while looking fine.

1. **Say what you did not verify.** A change you could not drive, because there was no credential, no Slack workspace or no data, is a change to flag, not to describe as done. Overclaiming is the single most expensive thing an agent does in this repository, because the human stops checking.
2. **Disclose that you were used.** See the AI-assisted contributions section of [CONTRIBUTING.md](CONTRIBUTING.md). The person opening the PR owns everything in it either way.

## Local working directories

`.claude/`, `.ai/` and `local/` are gitignored, and no contributor's tooling belongs in this repo's history. Keep private notes, drafts, and any agent's own working directory under `local/`, or add it to `.gitignore`. Do not reference their contents in code.

## Pointing your tool at this file

If your tool reads some other filename, add a pointer file rather than a copy. A second copy of these rules drifts from the first within a week.

For rules that apply to one part of the tree only, add a nested `AGENTS.md` in that directory rather than growing this one — agents read the nearest file in the tree, so the closest one wins ([apps/web/AGENTS.md](apps/web/AGENTS.md) is the example). For a job with a right order, add a skill under `.agents/skills/` and a row to [.agents/README.md](.agents/README.md) instead.
