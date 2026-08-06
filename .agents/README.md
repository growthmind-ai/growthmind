# .agents — instructions any coding agent can read

[AGENTS.md](../AGENTS.md) at the repo root is the contract: stack, commands,
conventions, and what gets a PR declined. It is the file every current coding
agent looks for without being configured.

This directory holds the next layer down — **procedures for jobs that have a
right order in this codebase**, where getting the order wrong produces code
that passes every gate and is still wrong.

`skills/` is deliberately tool-neutral. These are plain Markdown files with a
name and a description at the top; nothing here is specific to one vendor's
agent, and nothing here is generated. Point whatever tool you use at them, or
read them yourself — a human following one of these gets the same answer.

| Skill                                                        | Read it before                                                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| [verify-a-change](skills/verify-a-change/SKILL.md)           | Claiming a change works. Proving the edit reached the running process is a separate step from the tests passing.   |
| [adding-a-worker-task](skills/adding-a-worker-task/SKILL.md) | Adding anything to the Graphile Worker lane. The registration is stringly-typed and the crontab is parsed at boot. |
| [adding-an-api-route](skills/adding-an-api-route/SKILL.md)   | Adding a route under `apps/web/app/api/`. Tenant scope and schema ownership are decided here or not at all.        |
| [writing-a-unit-test](skills/writing-a-unit-test/SKILL.md)   | Writing tests. This repo's tests are named after invariants and its fakes throw on purpose.                        |
| [edge-sweep](skills/edge-sweep/SKILL.md)                     | Declaring a change done. Walks the D1–D12 taxonomy against the surfaces you touched.                               |
| [opening-a-pr](skills/opening-a-pr/SKILL.md)                 | Pushing a branch. Three gates run in CI that `bun run check` does not, and each one has caught a green local tree. |

If a skill is wrong or out of date, that is a bug — open an issue. A stale
procedure that reads as authoritative is worse than no procedure, because it
gets followed.
