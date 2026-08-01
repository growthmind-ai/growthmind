# Growthmind, Contributor Guide (for humans and their coding agents)

Growthmind is an open-source growth engine: evidenced findings in Slack, fix specs
dispatched to your coding agent, verified keep-or-kill experiments. Read
[README.md](README.md) for the product and [docs/product-decisions.md](docs/product-decisions.md)
for the commitments this codebase is built against, **a PR that violates a product
decision will be declined regardless of code quality**, so check there first.
[docs/architecture.md](docs/architecture.md) maps each of those commitments to the
subsystem that enforces it; read it before adding one.

This file is the whole guide, and it applies whichever agent you use. It sits at
`AGENTS.md` because that is the filename coding agents now look for without being
configured. `CLAUDE.md` and `.github/copilot-instructions.md` are pointers to this
file, not second copies. If your tool reads some other filename, point that file
here too. A second copy of these rules drifts from the first within a week.

Two files sit one level down from this one, and both are worth the minutes:

- **[REVIEW.md](REVIEW.md)**, what gets a PR sent back here, distilled from this
  repo's own history. Every entry is a change that passed typecheck, passed lint,
  passed its tests, and was still wrong. Read it before you write, not after.
- **[.agents/skills/](.agents/README.md)**, procedures for the jobs that have a
  right order: adding a worker task, adding an API route, writing a test that
  would have caught the bug, verifying a change actually works, sweeping the
  edge cases. Plain Markdown, no vendor lock-in.

## Stack

- **Runtime/tooling**: bun (package manager + scripts). `bun install`, `bun run dev`.
- **Web**: Next.js 16 (App Router), React 19.2, TypeScript strict, Mantine v9
- **Data**: Postgres + Drizzle ORM (+ pgvector)
- **Auth**: Better Auth
- **Jobs**: Graphile Worker (Postgres-backed; cron with backfill)
- **Validation**: Zod v4. Single source of truth for shapes
- **AI**: Vercel AI SDK; batch analysis via Anthropic Batch API

## Commands

```bash
docker compose up    # full stack from a clean clone: postgres + web + worker
bun install          # deps
bun run dev          # Next.js dev server (:3000)
bun run dev:worker   # Graphile Worker, second terminal
bun run typecheck    # tsc --noEmit, every package
bun run lint         # oxlint
bun test             # unit tests (bun test runner — never Jest/Vitest)
bun run build        # production build
bun run check        # all of the above + format check — must pass before any PR
bun run db:generate  # drizzle migration from schema changes
bun run db:migrate   # apply migrations
```

No.env needed locally, development defaults cover everything; `.env.example`
documents each variable. Auth schema changes: edit `apps/web/lib/auth.ts`, then
`bun run db:generate:auth && bun run db:generate` (never hand-edit
`packages/db/src/schema/auth.ts`).

## Conventions

- **Self-host is first-class**: every feature must work under `docker compose up`
  with no external SaaS dependency. If your change needs a cloud service, it needs
  a self-host path or a graceful absence.
- **Pure functions get unit tests**. Extractors, scorers, resolvers, diff utilities.
  No shipping without tests for pure logic.
- **Events/analytics discipline mirrors the product's own rules** (§2–§4 of the
  product decisions): deterministic IDs, no PII in streams, internal traffic excluded.
- **Plain English in customer-facing strings**. See the language rules in the
  product decisions (§10). No product jargon, counts always carry denominators.
- Keep `page.tsx` files as server components; client logic lives in separate
  `"use client"` components.

## Repo layout

```
apps/web/          # Next.js dashboard-less app (findings, settings, billing)
packages/sdk-js/   # the event package — capture, masking, exclusions
packages/db/       # Drizzle schema + migrations (+ generated auth schema)
packages/shared/   # Zod schemas, shared types (env validation lives here)
worker/            # Graphile Worker process (analysis pipeline, batch polling)
docs/              # product decisions, architecture, stack — shipped contracts
.agents/skills/    # procedures for the jobs that have a right order (any agent)
```

## Comments

Comments here explain **why**, not what. The bar is: state the reasoning the
next reader could not recover from the code alone. Why a check sits before the
thing it protects, which two states may never collapse into one, what a
plausible-looking simplification would break.

Keep them short and keep them in plain prose:

- No section banners, ASCII rules, or box-drawing.
- No shouting. Emphasis is the sentence, not capital letters.
- No shorthand a reader outside the project cannot resolve. Cite a file, a test,
  or a doc under `docs/` instead.
- Long-form design rationale belongs in `docs/`, where it gets reviewed and
  versioned as documentation. A comment links to it rather than restating it.

[docs/reliability-checklist.md](docs/reliability-checklist.md) is the list of
ways this kind of system actually breaks in production. It is worth a pass
before you call a change done, and it is where a comment should point when it is
guarding against one of those cases.

Unit tests live in `__tests__/` directories next to the code they cover.
Worker task names are exported constants in `worker/src/task-names.ts`, never
raw strings, the registry test enforces it.

## If you are a coding agent

Everything above applies to you. These five are addressed to you specifically,
because they are the ways an agent's work goes wrong here while looking fine.

1. **The product contract can require you to refuse.**
   [docs/product-decisions.md](docs/product-decisions.md) §1–§12 is not a style
   guide, a change that violates a published decision is declined regardless of
   how good the code is, and [GOVERNANCE.md](GOVERNANCE.md) lists the ones people
   try most (a dashboard, a ranked list, PII in the event stream, writing into a
   customer's repo, an external SaaS with no self-host path). If the task you were
   given requires one of those, **say so and stop** rather than building it well.
   The route to changing a decision is an issue, before the code.

2. **`bun run check` is not optional and not skippable.** It is
   `typecheck + lint + format:check + bun test + build`, and it is what CI runs.
   Do not report a change as working on the strength of a typecheck. Then run
   [.agents/skills/verify-a-change](.agents/skills/verify-a-change/SKILL.md) —
   passing tests do not prove your edit reached the running process, and in this
   repo that gap has produced a worker that crashed on boot and an env loader that
   failed in silence.

3. **Never hand-edit a generated file.** `packages/db/src/schema/auth.ts` comes
   from `apps/web/lib/auth.ts` via `bun run db:generate:auth`; migrations under
   `packages/db/drizzle/` come from `bun run db:generate`; `bun.lock` comes from
   `bun install`. A hand-edit there succeeds, passes, and is reverted by the next
   person who runs the generator.

4. **bun, everywhere.** `npm`, `yarn`, `pnpm`, and `npx` write a second lockfile
   that CI's `bun install --frozen-lockfile` will reject. `bun run typecheck`, not
   a bare `tsc`, the script covers every workspace, a direct `tsc` covers one and
   reports a green CI will not reproduce.

5. **Say what you did not verify.** A change you could not drive, no credential,
   no Slack workspace, no data. Is a change to flag, not to describe as done.
   Overclaiming is the single most expensive thing an agent does in this
   repository, because the human stops checking.

Disclose that you were used: see the AI-assisted contributions section of
[CONTRIBUTING.md](CONTRIBUTING.md). The person opening the PR owns everything in
it either way.

## Local working directories

`.claude/`, `.ai/`, and `local/` are local working directories and are
gitignored, don't commit them or reference their contents in code. `local/`
is where a maintainer or contributor keeps private notes and drafts beside
the code without any risk of publishing them. If the agent you use keeps its
own working directory, put it under `local/` or add it to `.gitignore`, no
contributor's tooling belongs in this repo's history.
