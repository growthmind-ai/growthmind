---
name: adding-a-worker-task
description: Add or change a Graphile Worker task — task-name constant, pure task function, registration, crontab, and the retry/terminal-state obligations. Use when touching anything under worker/.
---

# Adding a worker task

Graphile Worker matches jobs to handlers **by string name**. A job queued under
a name nothing registers does not error — it retries forever, invisibly. That
is why none of the steps below are optional, and why the order matters.

## 1. Name it in `worker/src/task-names.ts`

Add a constant to `TASK`. Never write the raw string anywhere else — not in
`addJob`, not in the crontab, not in a test.

Two rules the file itself records the reason for:

- **The separator is a colon, not a dot.** Graphile Worker's crontab parser
  accepts a letter or underscore followed by letters, digits, colon, slash,
  underscore or hyphen. A dot fails to parse and the worker **crashes on boot**
  — which unit tests will not catch, because nothing below the crontab string
  is fed to the real parser.
- **Names are vendor- and channel-agnostic.** `session-source:poll-schedule`,
  not `posthog:poll-schedule`. A rename the day a second adapter lands is
  exactly the stringly-typed hazard above: jobs queued under the old name sit
  retrying forever.

## 2. Write the task as a plain function

`worker/src/tasks/<name>.ts` exports a plain `async` function with **no queue
types in its signature**, taking its effects as ports/deps. This is what makes
the whole lane drivable end to end through its real entry point with fakes —
see [worker/src/tasks/delivery-tick.ts](../../../worker/src/tasks/delivery-tick.ts),
which is the pattern to copy.

The composition root decides nothing. Judgements live in pure functions that
are unit tested on their own; the task function runs them in one order.

## 3. Register it in `worker/src/index.ts`

Add the handler to `taskList`, keyed by the `TASK.*` constant. `index.ts` is
the only queue-aware file — keep the import of queue types there.

## 4. Schedule it, if it is scheduled

Add a line to the exported `crontab` array, interpolating the constant:

```ts
`*/15 * * * * ${TASK.YOUR_TASK}`;
```

## 5. The registry test

[worker/\_\_tests\_\_/registry.test.ts](../../../worker/__tests__/registry.test.ts)
asserts the queued side and the handler side stay in step. If your task needs a
new assertion there, add it — that test is the reason a typo is a failing test
rather than a silent production no-op.

## The obligations every task carries

- **Retry safety (D4).** The runtime _will_ replay your task. A retry after a
  partial failure must not repeat a completed side effect — claim before you
  post, and make the claim atomic.
- **A terminal state on every exit path (D8).** Every start writes `completed`
  or `failed`. A path that exits without one leaves a customer looking at a job
  stuck "running" forever. When a task fails closed, it still writes and
  finishes its run row — see
  [worker/src/tasks/session-source-poll.ts](../../../worker/src/tasks/session-source-poll.ts).
- **Tenant scope comes from the row, never the payload (D7).** A cron-triggered
  task has no caller and must derive its scope from the connection/record it is
  processing —
  [packages/db/src/system/system-context.ts](../../../packages/db/src/system/system-context.ts).
- **The actor is a closed union, not a string.** Use the `SystemActor` union in
  [packages/db/src/system/system-actor.ts](../../../packages/db/src/system/system-actor.ts).
  A generic constant holding one specific value gets reused by the next
  background writer and stamps its audit rows with the wrong actor — correctly
  typed, silently wrong (D9).
- **Failure isolation (D8).** A failing Slack post or notification is logged and
  does not propagate into the main flow's result.

## Verify

`bun test` is not enough here. **Restart the worker and confirm it boots** —
that is the only step that exercises the crontab parser. See
[verify-a-change](../verify-a-change/SKILL.md).
