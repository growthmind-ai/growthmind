---
name: opening-a-pr
description: The gates a change passes before it becomes a pull request — the local gate, the three CI gates that `bun run check` does not run, and the pre-push hook. Use before pushing a branch.
---

# Opening a PR

`bun run check` is the gate, and it is not skippable: typecheck, lint,
format, tests, production build. Do not report a change as working on the
strength of a typecheck.

A green `check` is necessary and not sufficient. Three gates run in CI that it
does not run, and each of them exists because a change passed everything local
and was still broken.

## 1. `bun run db:generate` must leave the tree clean

A schema edit with no generated migration typechecks, lints, and passes every
test. The code and the migrations only disagree at runtime, against a real
database.

```bash
bun run db:generate
git status --porcelain packages/db/drizzle    # must be empty
```

Auth schema changes take two generators, in this order: edit
`apps/web/lib/auth.ts`, run `bun run db:generate:auth`, then
`bun run db:generate`. `packages/db/src/schema/auth.ts` is generated output —
editing it directly succeeds, passes, and is wiped out by the next person who
runs the generator.

## 2. `__tests__/undeclared-dependencies.test.ts`

An import of a package the workspace does not declare resolves fine against a
laptop's accumulated `node_modules` and fails here. The fix is a dependency
entry in that workspace's `package.json`, never a relative reach into another
workspace's tree.

## 3. `docker compose up` from a clean clone, then `/api/health`

Self-hosting is not the lesser option, so the compose path is a gate rather
than a nice-to-have. A green local `check` and a red CI means you skipped the
compose question.

If your change adds a dependency or an external service, answer that question
in the PR body: does a stranger still get a working app in one command, and if
the service is absent, does the feature fail softly and say so?

## The pre-push hook

[.githooks/pre-push](../../../.githooks/pre-push) runs typecheck + lint +
format:check, about nine seconds. `bun test` and `bun run build` are minutes,
so they stay in CI. `bun install` wires the hooks via `core.hooksPath`; bypass
with `git push --no-verify` when you want CI to be the judge.

## Then prove it ran

Passing tests do not prove your edit reached the running process, and in this
repo that gap has produced a worker that crashed on boot and an env loader that
failed in silence. [verify-a-change](../verify-a-change/SKILL.md) is the
procedure, and it is the last step before the PR, not an optional extra.

## In the PR body

- What you did **not** verify, and why — no credential, no Slack workspace, no
  data. A change you could not drive is a change to flag, not to describe as
  done.
- That an agent was used, if one was. See the AI-assisted contributions section
  of [CONTRIBUTING.md](../../../CONTRIBUTING.md).
- Any deliberate narrowing an [edge-sweep](../edge-sweep/SKILL.md) surfaced and
  you chose not to handle, named as a decision rather than left silent.
