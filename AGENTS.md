# Growthmind — Contributor Guide (for humans and their coding agents)

Growthmind is an open-source growth engine: evidenced findings in Slack, fix specs
dispatched to your coding agent, verified keep-or-kill experiments. Read
[README.md](README.md) for the product and [docs/product-decisions.md](docs/product-decisions.md)
for the commitments this codebase is built against — **a PR that violates a product
decision will be declined regardless of code quality**, so check there first.
[docs/architecture.md](docs/architecture.md) maps each of those commitments to the
subsystem that enforces it; read it before adding one.

This file is the whole guide, and it applies whichever agent you use. It sits at
`AGENTS.md` because that is the filename coding agents now look for without being
configured. `CLAUDE.md` is a pointer to this file, not a second copy — if your tool
reads some other filename, point that file here too. A second copy of these rules
drifts from the first within a week.

## Stack

- **Runtime/tooling**: bun (package manager + scripts). `bun install`, `bun run dev`.
- **Web**: Next.js 16 (App Router), React 19.2, TypeScript strict, Mantine v9
- **Data**: Postgres + Drizzle ORM (+ pgvector)
- **Auth**: Better Auth
- **Jobs**: Graphile Worker (Postgres-backed; cron with backfill)
- **Validation**: Zod v4 — single source of truth for shapes
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

No .env needed locally — development defaults cover everything; `.env.example`
documents each variable. Auth schema changes: edit `apps/web/lib/auth.ts`, then
`bun run db:generate:auth && bun run db:generate` (never hand-edit
`packages/db/src/schema/auth.ts`).

## Conventions

- **Self-host is first-class**: every feature must work under `docker compose up`
  with no external SaaS dependency. If your change needs a cloud service, it needs
  a self-host path or a graceful absence.
- **Pure functions get unit tests** — extractors, scorers, resolvers, diff utilities.
  No shipping without tests for pure logic.
- **Events/analytics discipline mirrors the product's own rules** (§2–§4 of the
  product decisions): deterministic IDs, no PII in streams, internal traffic excluded.
- **Plain English in customer-facing strings** — see the language rules in the
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
```

Code comments cite short identifiers (`D7`, `AD-20`, `FR-M9`, `SAC-10`).
[docs/spec-vocabulary.md](docs/spec-vocabulary.md) decodes the families and
defines the `D1`–`D12` edge-case taxonomy — read it before treating a comment's
tag as noise, and before simplifying a shape one of them explains.

Unit tests live in `__tests__/` directories next to the code they cover.
Worker task names are exported constants in `worker/src/task-names.ts`, never
raw strings — the registry test enforces it.

`.claude/`, `.ai/`, and `local/` are local working directories and are
gitignored — don't commit them or reference their contents in code. `local/`
is where a maintainer or contributor keeps private notes and drafts beside
the code without any risk of publishing them. If the agent you use keeps its
own working directory, put it under `local/` or add it to `.gitignore` — no
contributor's tooling belongs in this repo's history.
