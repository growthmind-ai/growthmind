## Target Outcome (this run only)

Focus this cycle's sprint selection on **O-001**. Find its block in OUTCOMES.md below and plan a sprint for it. Only pick a different outcome if O-001 is already complete or genuinely blocked — in that case, signal `blocked` and explain why rather than silently substituting a different outcome.

## OUTCOMES.md (actionable outcomes only)

# Growthmind — Outcomes

> Append-only. Never overwrite; machine-local shared state (internal/shared),
> shared across every growthmind worktree.
> One `## O-###:` block per outcome with Status / Why / Definition of done.
> ID range: O-001–O-099 (`Repo: growthmind`). Siblings: `extractbrand.md`, `website.md` —
> one file per repo; the queue mirrors the split — packets live in `../queue/<repo>/`.

<!-- ===== Growthmind MVP (docs/mvp.md is the cut line; added 2026-07-30) ===== -->

_0 completed outcomes hidden. Showing 10 actionable outcomes._

## O-001: M-0 spike — PostHog retrieval latency measured, adapter path decided (queued)
Repo: growthmind
Status: OPEN
Why: The 5–20 second glue-moment promise is the MVP's riskiest assumption
(mvp.md §3), and it is testable in an afternoon before anything is built.
Definition of done: in a test PostHog project, (a) a custom event, (b) an
exception/failed request, and (c) a session recording are each triggered
repeatedly; time-until-API-retrievable distribution recorded (not best case);
a written decision — pull adapter as planned vs minimal first-party capture
(rrweb events-only) fallback — committed to the repo, naming which
`SessionSource` implementation ships first.


## O-002: Tenancy + app-shell foundation (queued)
Repo: growthmind
Status: OPEN
Why: Org-scoped everything from day one — retrofitting tenancy is the one debt
that is never cheap later (mvp.md §4, architecture §9).
Definition of done: Better Auth with organizations live (signup → org); every
repository org-scoped by construction with no id-only mutation paths; write-key
ingest attribution modeled; `bun run typecheck && bun test && bun run build`
green; a cross-tenant access test proves org A cannot read/mutate org B rows.


## O-003: SessionSource port + PostHog adapter (queued)
Repo: growthmind
Status: OPEN
Depends on: O-001 (implementation choice), O-002 (org scoping)
Why: One port, one implementation — the boundary the M-0 spike swaps behind;
exclusions with declared fail directions live here, not at capture (mvp.md §4–5).
Definition of done: `SessionSource` defined in packages/adapters per
architecture §4.3; PostHog implementation pulls events for a connected project;
internal-domain and bot exclusions run at the adapter with declared fail
directions and near-miss fixtures (D-1/D10); free-mail guard on domain
inference active; live event counter available for onboarding step 2.


## O-004: T1 detectors + evidence gate (pure, tested) (queued)
Repo: growthmind
Status: OPEN
Depends on: O-003 (event shapes)
Why: A summary without deterministic proof predicates is an AI narrating a
session — the evidence gate is the product's identity, not a feature (mvp.md §4).
Definition of done: pure detectors over events only — failed request, error
event, rage click, dead click, funnel drop-off on path transitions; evidence
gate implements the §6 three-way split (pass / downgrade — a `broken` claim
without the failed or absent request degrades to `confusing` / reject); every
pure function unit-tested with declared fail directions; all counts carry
denominators.


## O-005: Synchronous cold-start analysis lane (queued)
Repo: growthmind
Status: OPEN
Depends on: O-004
Why: The only MVP analysis lane (T-1) — turns detector hits into a plain-English
summary under a hard per-project cost cap; the Batch lane arrives with scale.
Definition of done: synchronous skim/read produces a summary carrying class,
confidence, sample size, and denominators; hard per-project cap enforced — the
MVP never runs a model over every event (§12); model output Zod-validated
before persistence; staged degradation path declared when the model call fails.


## O-006: Signature ledger — never twice, dismissed forever (queued)
Repo: growthmind
Status: OPEN
Depends on: O-004 (finding shape)
Why: Early testers seeing the same finding twice destroys the credibility the
MVP exists to test; two tables and a hash, binding from the first finding.
Definition of done: finding signature computed and persisted; a second
identical failure the same day produces no second delivery; "Not useful"
suppresses the signature permanently; golden-fixture test proves signature
stability across surface churn (D-12) with surfaces as URL paths, so the later
ts-morph swap is absorbed by ancestry, not a re-key.


## O-007: Delivery — scheduler, Slack renderer, residual PII scanner (queued)
Repo: growthmind
Status: OPEN
Depends on: O-005, O-006
Why: One finding at a time, in plain English, where the team already works —
the steady-state product surface (mvp.md §4, product decisions §7/§10).
Definition of done: scheduler enforces one open finding + an explicit
nothing-today state (token bucket may start as a constant); Slack message
renders inside the legibility budget — plain English, no product jargon,
counts with denominators; residual PII scanner passes over generated text
before any push or post; duplicate delivery is idempotent (D4); a Slack
delivery failure never breaks the pipeline's persisted state (D8).


## O-008: Onboarding — five steps to the glue moment (queued)
Repo: growthmind
Status: OPEN
Depends on: O-003, O-007, O-009
Why: Steps 1–4 are the product being honest about what it needs; step 5 is the
demo of the product — the moment the whole MVP exists for (mvp.md §1–2).
Definition of done: connect repo (read-only, shallow) → repo + default branch
shown; connect PostHog → live event counter ticks and masking config verified
(§5); connect Slack → test message arrives (skippable, with an honest
degraded-mode notice per deviation 2); install MCP → `list_open_fixes` returns
empty-but-valid; trigger an issue → summary pushes to the onboarding screen in
5–20 s, then Slack; each step completes in under a couple of minutes; the
first-run surface is never linkable back to and holds no history (deviation 1).


## O-009: MCP read-only server + minimal fix spec (queued)
Repo: growthmind
Status: OPEN
Depends on: O-002 (auth), O-006 (findings exist)
Why: "Get it fixed" must lead somewhere real — a fix spec a coding agent can
read over MCP makes onboarding step 4 honest (mvp.md §4).
Definition of done: MCP server exposes `list_open_fixes`, `get_fix`,
`get_finding`; minimal fix spec is structured state rendered to plain
sentences (no code); verified working from a real coding agent against a real
finding; every tool call is org-scoped and authenticated.


## O-010: MVP acceptance — the glue moment end-to-end (queued)
Repo: growthmind
Status: OPEN
Depends on: O-001–O-009
Why: mvp.md §8 is the hypothesis test — break your own product and watch
Growthmind narrate it with evidence within seconds; this outcome is that
checklist executed, not re-specified.
Definition of done: a fresh user completes onboarding steps 1–4 in under ten
minutes without help; a real triggered failure lands on the onboarding screen
within 20 seconds with evidence attached and class named; the same finding
arrives in Slack inside the legibility budget; a second identical failure that
day produces no second message; "Not useful" suppresses permanently; "Get it
fixed" yields an MCP-readable fix spec; full validation gate green with every
pipeline pure function unit-tested with declared fail directions.


## ROADMAP.md

# Growthmind — Roadmap

> Direction, not commitments. Sibling of outcomes/growthmind.md (intent) and BUGS.md (defects).

