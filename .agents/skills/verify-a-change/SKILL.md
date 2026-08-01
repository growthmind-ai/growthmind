---
name: verify-a-change
description: Prove a change actually works — run the gate, then drive the change through the running process and confirm the edit reached it. Use before claiming a change is done, and before opening a PR.
---

# Verify a change

`bun run check` passing is necessary and not sufficient. It proves the code
compiles, lints, and satisfies its tests. It does not prove the edit reached
the process that runs it, and it does not prove the behaviour changed.

Three steps, in this order. Do not skip step 3 because step 1 was green.

## 1. The gate

```bash
bun run check   # typecheck + lint + format:check + bun test + production build
```

This is what CI runs. If you want the pieces individually:
`bun run typecheck`, `bun run lint`, `bun run format:check`, `bun test`,
`bun run build`.

A failure here is never "unrelated" until you have proved it on the base
branch. Do not `git stash` to check that — you risk the work. Check out the
base in a separate worktree and run it there.

## 2. Drive it

Start what your change touches, and exercise the change itself — not the page
next to it.

```bash
docker compose up postgres   # database only
bun run dev                  # web, :3000
bun run dev:worker           # worker, second terminal
```

| Changed                | Drive it by                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| A page or component    | Load the route in a browser. Console errors count as failures.                                            |
| An API route           | Call it with the credential a real caller would use. A 200 with the wrong scope is a failure, not a pass. |
| A worker task          | Let the tick fire, or invoke the exported task function directly. Watch the log line it writes.           |
| Anything env-dependent | Confirm the variable is actually loaded — not defaulted (see the note below).                             |

Full-stack check, which is also the CI compose job:

```bash
docker compose up --build --detach --wait
curl --fail http://localhost:3000/api/health
docker compose down --volumes
```

## 3. Prove the edit reached the process

This is the step that catches the failures the first two miss. Each of these
has actually happened in this repository:

- **The worker parses its crontab at boot.** A task-name change that the
  parser rejects crashes the worker on startup and passes every unit test —
  nothing below the crontab string had been fed to the real parser
  ([worker/src/task-names.ts](../../../worker/src/task-names.ts)). After any
  change to task names, registration, or the crontab: **restart the worker and
  confirm it boots**, then confirm your task appears in its startup log.
- **A dev server can serve a stale module.** If your change does not appear,
  restart `bun run dev` before concluding the change did not work — and before
  writing a second change on top of a wrong conclusion.
- **A missing env var can look like a working app.** Every strictly-required
  variable has a development default, so the app boots fine and only the
  optional ones go missing — silently
  ([apps/web/instrumentation.ts](../../../apps/web/instrumentation.ts)). If
  your change depends on a variable, log it or assert it; do not infer it from
  the app starting.
- **A green suite can be wired to the wrong dependency.** If your change is a
  composition (which port a route or task gets), the composition itself needs a
  test — a correct handler beside a route wired to the wrong source passes
  everything else
  ([apps/web/\_\_tests\_\_/mcp/wiring.test.ts](../../../apps/web/__tests__/mcp/wiring.test.ts)).

## What does not count as verified

- "Typecheck passes" — does not execute anything.
- "The build succeeded" — does not exercise interaction.
- "The tests pass" — proves what the tests assert, which may not include the
  boundary you changed.
- "I read the code and it looks right" — never substitutes for running it.

## Report it honestly

Say which of the three steps you ran and what you saw. If you could not drive
the change (no credential, no data, no Slack workspace), say that explicitly
and name what would have to be true to verify it. An unverifiable change
labelled verified is the one failure this whole file exists to prevent.
