# Contributing

Growthmind is MIT-licensed and built in the open. Contributions are welcome —
code, tests, docs, and arguments with our decisions all count.

## The one rule that outranks code quality

This codebase is built against [docs/product-decisions.md](docs/product-decisions.md).
**A PR that violates a product decision will be declined regardless of how
good the code is.** Read it first — it is short, and it is the contract.
[docs/architecture.md](docs/architecture.md) maps each decision to the
subsystem that enforces it, and [docs/stack.md](docs/stack.md) explains why
each dependency was chosen (and which were rejected, so we don't re-litigate).

If you think a decision is wrong, open an issue and argue with it — that is
exactly what publishing them is for. Just do it before writing the code, not
in the PR that violates it.

This project is founder-led, and [GOVERNANCE.md](GOVERNANCE.md) says plainly
who decides, what is open to contribution and what isn't, and how commit
access could be earned. Worth two minutes before a large PR.

## Getting started

```bash
git clone https://github.com/growthmind-ai/growthmind.git
cd growthmind
docker compose up          # full stack: Postgres + web + worker
```

For day-to-day development:

```bash
bun install                # bun 1.3+ (https://bun.sh)
docker compose up postgres # just the database
bun run dev                # Next.js app on :3000
bun run dev:worker         # Graphile Worker, in a second terminal
```

No .env file is needed locally — development defaults cover everything, and
`.env.example` documents every variable when you want to override one.

## Before you open a PR

```bash
bun run check   # typecheck + lint + format + tests + production build
```

CI runs the same gate plus a `docker compose up` boot from a clean clone, so
a PR that passes locally passes there. Two things CI will not forgive:

- **Self-host is first-class.** Every feature works under `docker compose up`
  with no external SaaS dependency, or ships with a graceful absence path.
  If your PR adds a dependency, answer the compose question in the PR body:
  does a stranger still get a working app in one command?
- **Pure functions get unit tests.** Extractors, scorers, resolvers, diff
  utilities — no shipping without tests for pure logic. Tests live in
  `__tests__/` directories and run with `bun test`.

Licence check for new dependencies: read the LICENSE file of anything
infra-layer in the PR that adds it (docs/stack.md explains why — the
MIT-to-BSL relicensing wave is real).

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org): a `type(scope):`
prefix and a subject in the imperative mood, under about 72 characters.

```
feat(sdk-js): mask input values at capture
fix(worker): backfill missed rollups on restart
docs: explain the finding signature ledger
```

Types in use: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`,
`build`, `ci`, `chore`. Where a change has a reason that isn't obvious from
the diff, put it in the body — the log is the only record of _why_.

## Conventions worth knowing

- **bun everywhere** — package manager, test runner, script runner. Never
  yarn or pnpm here.
- **Zod schemas in `packages/shared` are the single source of truth for
  shapes.** Don't duplicate a shape the schema already owns.
- **`page.tsx` files stay server components**; client logic lives in
  separate `"use client"` components.
- **Plain English in customer-facing strings** — no product jargon, and
  counts always carry denominators (product decisions §10).
- **Events discipline mirrors the product's own rules** — deterministic IDs,
  no PII in streams, internal traffic excluded (§2–§4).

## Security issues

Never open a public issue for a vulnerability — see [SECURITY.md](SECURITY.md).

## Licence

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE), the same terms as the project.
