# Spec vocabulary — the identifiers in the code comments

Growthmind's source comments are dense with short identifiers: `D7`, `AD-20`,
`FR-M9`, `SAC-10`, `D-2`, `O-011`. They are load-bearing — they mark which
decision a piece of code is discharging, and why an obvious-looking
simplification would break something — but they are opaque unless you know the
families.

This page is the key. It exists because roughly 1,700 of these references appear
across the source and, until it was written, none of them could be resolved by
anyone outside the core team.

**The short version:** you never need to resolve an identifier to understand a
comment. Every one of them sits beside prose that states the reasoning in full —
that is the house style, and it is deliberate. The tag tells you _where the
decision was ratified_, not _what it says_.

---

## The families at a glance

| Prefix                   | Means                                              | Resolvable here?                                              |
| ------------------------ | -------------------------------------------------- | ------------------------------------------------------------- |
| `D1`–`D12`               | Edge-case taxonomy dimension                       | ✅ [below](#d1d12--the-edge-case-taxonomy)                    |
| `SAC-1`–`SAC-12`         | String Assertion Contract row                      | ✅ in source — see [SAC](#sac--the-string-assertion-contract) |
| `D-1`, `D-2`, …          | A numbered decision inside one sprint's design doc | ❌ internal                                                   |
| `AD-0`, `AD-20`, …       | Architecture Decision, from a sprint's ADD         | ❌ internal                                                   |
| `FR-3`, `FR-M9`, …       | Functional Requirement, from a sprint's PRD        | ❌ internal                                                   |
| `O-003`, `O-011`, …      | Outcome / sprint id                                | ❌ internal                                                   |
| `W0`, `W1`, …            | Wave (a stage within one sprint's task plan)       | ❌ internal                                                   |
| `CR-13`, `ESC-9`, `BS-4` | Code-review finding, escalation, blind spot        | ❌ internal                                                   |
| `M-1`, `H-2`             | Security-audit finding, by severity                | ❌ internal                                                   |

Note the collision, because it bites: **`D7` and `D-7` are different things.**
Unhyphenated `D` + digits is always the edge-case taxonomy below. Hyphenated
`D-7` is decision 7 of whichever design document the file's header names.

---

## D1–D12 — the edge-case taxonomy

By far the most-cited family (~620 references) and the most useful to know. It
is a checklist of the ways a multi-tenant event-pipeline codebase actually
breaks in production, kept as a living document and added to whenever a new
class of bug reaches production.

When a comment says "D8 isolation" or "the D12 fork", it is naming one of these:

|         | Dimension                 | The failure it names                                                                                                                                                                         |
| ------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1**  | Actor / audience          | Works for the person who set it up. An org-scoped effect published only to the acting user leaves teammates blind.                                                                           |
| **D2**  | Scope                     | User-level logic on an org-level resource, or the reverse. Includes stamp/filter asymmetry — a read filtered on a column the write path never sets matches zero rows and reads as "no data". |
| **D3**  | Multiplicity              | One vs many. Two matching rows fan out twice; two code paths produce one logical effect twice; zero rows silently no-op.                                                                     |
| **D4**  | Delivery                  | Runs twice, out of order, never, or retried. Webhooks, worker tasks, and any UI gated on a single live signal.                                                                               |
| **D5**  | Data shape                | Null, empty, sparse, boundary, legacy. Production contains every shape ever written, not the shape today's schema declares.                                                                  |
| **D6**  | Concurrency               | Two writers, read-then-write. Anything that should have been one atomic statement.                                                                                                           |
| **D7**  | Tenant boundary           | The path that steps outside the request→context→service→repository flow: system contexts, hand-written aggregations, client-supplied ids.                                                    |
| **D8**  | Failure isolation         | A non-critical side effect that killed the main flow — or a missing terminal state that leaves a job stuck "running" forever.                                                                |
| **D9**  | Stringly-typed keys       | The wrong string as a runtime fact instead of a compile error. Task names, event names, query params, ids.                                                                                   |
| **D10** | Classifier fail-direction | A deterministic gate (keyword rule, bot filter, threshold) _will_ miss real inputs. The question is which way it fails, and whether that direction is safe.                                  |
| **D11** | Producer/consumer wiring  | A value is computed and then dropped on the floor. The consumer reads an always-absent field, and its "when present" branch never runs.                                                      |
| **D12** | Identity churn            | A deterministic id whose inputs are not deterministic. When a derived input churns, the identity forks and every dedup guarantee hanging off it silently fails open.                         |

The recurring shape across all twelve: **the code works for the person who set
it up, in the happy state, on the first try** — and fails quietly for everyone
and everything else.

---

## SAC — the String Assertion Contract

`SAC-1` … `SAC-12` govern what a generated summary is allowed to assert about a
customer's product. **These resolve in this repository**, in full, with prose
for each row:

> [`packages/shared/src/summary/assertion-contract.ts`](../packages/shared/src/summary/assertion-contract.ts)

Each row carries `mayAssert`, `mayNotAssert`, and a citation to the test that
enforces it. Rows with no enforcing test live in a separate
`SAC_NOT_YET_ENFORCED` record that names why — the partition is compile-total,
so a row in neither fails `bun run typecheck`.

That file is worth reading as the model this page follows. Its own header
explains the move: the contract originally lived only in gitignored sprint
artefacts, so one cleanup would have destroyed the rules governing the most
customer-facing text the product produces. Transcribing them into git-tracked
source is what made them real.

The rule the contract yields, stated once:

> The summary is a rendering of a proof. Every assertion in it must be traceable
> to a field on the `CandidateFinding` or to the gate's own reason table. A
> sentence that is true only on the path its author imagined is a false sentence
> on every other path, and it will ship.

---

## The internal families

`AD-`, `FR-`, `D-`, `O-`, `W`, `CR-`, `ESC-`, `BS-`, `M-`/`H-` resolve to
sprint artefacts — PRDs, Architecture Decision Documents, task plans, review and
audit logs — that are not published. They are gitignored here by design
(`docs/prds/`, `docs/adds/`, `tasks/`), because they contain product strategy
alongside the engineering decisions.

**This does not block you.** The convention that makes it workable is that the
comment always carries the reasoning, and the tag only carries the provenance:

```ts
// COPIED, NOT SUBSTITUTED. The column is nullable and the candidate's own
// `null` means "no normaliser version was recorded" — a fact, and one this
// file must not overwrite. It previously wrote `0` there, which the candidate
// contract allows a producer to emit as a REAL version, so absence and v0
// became one stored value on a column that feeds D12 identity comparisons.
```

You can act on that without ever resolving `FR-M9`. If a comment ever fails that
standard — if the tag is doing work the prose does not — that is a documentation
bug worth raising as an issue.

A few of the more frequently cited internal decisions, in case the shorthand
appears without context:

- **AD-9** — the analysis lane's degradation ladder: the fixed order of rungs a
  candidate falls through (no key → cap spent → already claimed → call failed →
  output invalid → guard rejected → rendered). Documented in full at the top of
  [`worker/src/analysis/plan.ts`](../worker/src/analysis/plan.ts).
- **AD-20** — a finding's identity is derived from its content, once, before the
  cap is claimed. See [`worker/src/analysis/gates.ts`](../worker/src/analysis/gates.ts).
- **D-B** — every repository takes a `TenantContext` at construction; no
  repository method accepts an organization id as a parameter. Enforced by
  `packages/db/__tests__/repositories/no-org-param.test.ts`.
- **D-10** (in the session-source design) — the worker's system scope is
  reachable only through the `@growthmind/db/system` subpath. Enforced by
  `packages/db/__tests__/system/reachability.test.ts`.

---

## Why the comments are like this

About half the lines in `packages/` and `worker/` are comments. That is
deliberate and it is not API documentation — it is the reasoning that would
otherwise be lost: why a check sits _before_ the thing it protects rather than
beside it, which two states may never collapse into one, what a "safe" default
would actually be unsafe for.

The house rules those comments follow:

- **Name the fail direction.** A gate that can be wrong states which way it is
  allowed to be wrong, and why that direction is the safe one.
- **Name what may never collapse.** Where two states look interchangeable and
  are not, say so where someone would merge them.
- **A deferral is written down in source**, not in a tracker — including what is
  deliberately not built, and what a reader should not conclude from its
  absence.
- **Customer-facing strings have one home** (`@growthmind/shared`), and a
  comment near a second copy explains why it is not one.

If you are changing code here, matching that density matters less than matching
that discipline: state the reasoning that the next reader could not recover from
the code alone.
