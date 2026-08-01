---
name: edge-sweep
description: Walk the D1–D12 edge-case taxonomy against the surfaces a change touches and emit a handled/tested/unhandled matrix. Use before declaring a change done or opening a PR.
---

# Edge sweep

[docs/reliability-checklist.md](../../../docs/reliability-checklist.md) defines D1–D12: the
ways a multi-tenant event-pipeline codebase actually breaks in production. This
skill turns that list into a pass you run **before** saying a change is done.

It is analysis, not a build gate. On a change that touches none of the surfaces
below — styling, copy, docs, an internal rename — say `NO SWEEP NEEDED` and
stop. That is the correct outcome and it takes seconds.

## 1. Classify the surfaces the diff touches

| If the change touches…                                                                              | Walk                                                     |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| An org-scoped resource (project, connection, finding, experiment, API key) or a notification effect | **D1** actor/audience, **D2** scope, **D3** multiplicity |
| A DB read/write, repository, or service method                                                      | **D2**, **D6** concurrency, **D7** tenant boundary       |
| A worker task, webhook, or external sync (Slack, batch polling)                                     | **D4** delivery, **D3**, **D8** failure isolation        |
| An API route, query param, or DTO                                                                   | **D5** data shape, **D7**, **D9** stringly-typed keys    |
| Any model/agent surface                                                                             | **D5**, **D8**                                           |
| A deterministic gate — keyword rule, exclusion filter, threshold, router                            | **D10** fail-direction, **D5**                           |
| A dedup key, signature, or upsert conflict target computed from other values                        | **D12** identity churn, **D9**                           |

Do not force-fit dimensions the diff does not touch. A sweep that walks all
twelve on a two-line change is noise, and noise is how a real finding gets
skimmed past.

## 2. Answer the questions, out loud

For each dimension in scope, the questions are in
[docs/reliability-checklist.md](../../../docs/reliability-checklist.md). The ones that
catch the most here:

- **D1** — for an org-scoped effect, who receives the visible signal? If it is
  the acting user only, is that deliberate? Say which, out loud. What happens
  when there is no owner?
- **D2** — does the write path stamp every column the read path filters by? A
  filter on a never-stamped column matches zero rows and reads as "no data".
- **D3** — two matching rows: does the effect fire once or twice? Should it?
  Zero rows: clean degradation or a silent no-op that reads as success?
- **D4** — same payload twice: one write and one send? A retry after partial
  failure: does it repeat a completed side effect?
- **D5** — null, empty, sparse, boundary, and a legacy row shape.
- **D6** — is a read-then-write racing another writer? Should it be one atomic
  statement?
- **D7** — is a system/bypass context reachable from a user-triggered path? Does
  the hand-written query filter `organization_id` itself?
- **D8** — does every exit path write a terminal state? Does a failing side
  effect still let the main flow return success?
- **D9** — could this wrong string have been a compile error?
- **D10** — when this gate misses (it will), which way does it fail, and is that
  direction safe?
- **D11** — grep the consumer for the field name. Is it ever actually read? Ever
  written on the path that reaches the consumer?
- **D12** — for each input to the identity: what can change it, and what keeps
  it stable across that change?

## 3. Emit the matrix

One row per case, three columns — **handled**, **tested**, **unhandled**:

```
D7 tenant boundary  | cross-org read via client-supplied finding_id | handled | tested (cross-tenant-real-keys.test.ts)
D4 delivery         | tick replayed after partial post             | handled | UNTESTED
D1 audience         | teammate gets no signal on new finding       | UNHANDLED
```

## 4. What the findings do to the PR

- **Unhandled cross-tenant leak or data loss** — fix before the PR. Not a
  follow-up issue.
- **Wrong audience, duplicate effect, or stuck UI state (D1, D3, D4)** — fix
  before the PR, or name the deliberate scoping decision in the PR body
  ("owner-only by design").
- **Handled but untested** — add the regression test, or list it in the PR body
  as an explicit follow-up. Do not let it read as covered.

## The one-line gate

> **Who else** (teammate, admin, other-org, API-key caller) hits this, at
> **what scope** (user vs org), with **how many** matching rows or producers,
> delivered **how** (once, duplicate, retried, never, out of order), in **what
> shape** (null, empty, sparse, boundary, legacy) — and does a **failing side
> effect** still let the main flow succeed?

If any cell of that sentence is "I didn't check", the change is not done.
