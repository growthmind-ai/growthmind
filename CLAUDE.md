# Growthmind — Contributor Guide (for humans and their coding agents)

Growthmind is an open-source growth engine: evidenced findings in Slack, fix specs
dispatched to your coding agent, verified keep-or-kill experiments. Read
[README.md](README.md) for the product and [docs/product-decisions.md](docs/product-decisions.md)
for the commitments this codebase is built against — **a PR that violates a product
decision will be declined regardless of code quality**, so check there first.

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
bun install          # deps
bun run dev          # dev server
bun run typecheck    # tsc --noEmit
bun test             # unit tests
bun run build        # production build — must pass before any PR
```

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

## Repo layout (target shape)

```
apps/web/          # Next.js dashboard-less app (findings, settings, billing)
packages/sdk-js/   # the event package — capture, masking, exclusions
packages/db/       # Drizzle schema + migrations
packages/shared/   # Zod schemas, shared types
worker/            # Graphile Worker process (analysis pipeline, batch polling)
docs/              # product decisions, shipped contracts
```

`.claude/` and `.ai/` are local working directories and are gitignored — don't
commit them or reference their contents in code.
