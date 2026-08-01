# Growthmind: MVP

> The smallest product that produces the moment worth building everything else for:
> **break your own product, and within seconds watch Growthmind tell you what
> happened, with evidence.** This document is the cut line. Everything in
> [`architecture.md`](architecture.md) still governs _how_ the pieces are built;
> this document decides _which_ pieces exist first and which deliberately do not.
> A deviation from [`product-decisions.md`](product-decisions.md) is only allowed
> if it is named in [§7](#7-deviations-on-the-record), scoped, and given an expiry.
> The companion [`get-started.md`](get-started.md) scripts what this cut must
> _feel like_ on first run, beat by beat.

---

## 1. The glue moment

The MVP exists to test one hypothesis: a founder who watches Growthmind catch and
narrate a real issue in their own product, seconds after it happens, is glued.

The moment, precisely:

1. During onboarding, the user opens their own product and does something that
   goes wrong — a failed save, a dead button, a rage-click loop.
2. **While they are still standing on it**, the onboarding screen pushes the
   summary: what happened, to whom, the evidence (failed request, event
   sequence, counts with denominators), and what class of problem it is.
   (Originally "within 5–20 seconds" — amended by deviation 4 in §7 once M-0
   measured the real distribution. The moment is defined by the user still
   being present, which is what "glued" actually means, not by a number.)
3. After onboarding, that same summary arrives as a Slack message — the steady
   state. The onboarding screen is a **first-run surface, not a dashboard**: it
   exists once, during install, while the user is already present. Nothing is
   ever _checked_ there.

Everything in this document is ranked by whether it makes that moment happen
sooner, more credibly, or not at all.

## 2. Onboarding flow

Five steps, in order, each ending in a visible confirmation:

| Step | What happens                                                                         | Confirmation                                                                                           |
| ---- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| 1    | **Connect repo** (read-only, shallow — context for fix specs, not full taxonomy)     | Repo listed, default branch shown                                                                      |
| 2    | **Connect PostHog** (their existing project, API key — most targets already have it) | Live event counter ticks                                                                               |
| 3    | **Connect Slack** (channel picked)                                                   | Test message arrives in-channel                                                                        |
| 4    | **Install the MCP server** in their coding agent                                     | `list_open_fixes` returns an empty-but-valid response                                                  |
| 5    | **Trigger an issue** in their own product                                            | The summary pushes to the onboarding screen while they are still on it, then to Slack (§7 deviation 4) |

Step 5 is the demo of the product; steps 1–4 are the product being honest about
what it needs. If any step takes more than a couple of minutes, that step is a
bug.

## 3. The gating spike, run before anything is built

The 5–20 second promise is the riskiest assumption in this document, and it is
testable in an afternoon:

> **M-0:** In a test PostHog project, trigger (a) a custom event, (b) an
> exception/failed request, and (c) a session recording. Measure time until each
> is retrievable via the API. Repeat enough times to see the distribution, not
> the best case.

The decision tree it feeds:

- **Events retrievable in seconds** → build on the PostHog adapter as planned.
  The summary ships from _events_ (failed request, error, rage click); the
  replay clip follows later if and when the recording lands. The finding does
  not wait for the clip, exactly as T-4 in the architecture already allows.
- **Events take minutes** → the glue moment cannot ride the pull adapter. Fall
  back to a minimal first-party capture path (rrweb events-only, no replay) for
  the onboarding moment, keeping PostHog as the historical/backfill source.
  This is the only scenario in which the MVP builds capture code.

Either way the `SessionSource` port is the boundary. The spike changes which
implementation ships first, never the shape of the pipeline behind it.

## 4. What is in, what is out

**In, and not thinned, because they are the product's identity:**

- **Evidence gate**. A summary without deterministic proof predicates is an
  AI narrating a session, which §6 exists to prevent. Pure functions, cheap,
  non-negotiable.
- **Signature ledger**. Two tables and a hash. Never-twice and
  dismissed-forever must be true from the first finding, or early testers see
  the same finding twice and the credibility the MVP exists to test is gone.
- **Delivery scheduler**, minimal: one open finding, nothing-today state.
  The token bucket can start as a constant.
- **Slack renderer** with the legibility budget. Plain English, denominators,
  no product jargon (§10).
- **Cold-start synchronous lane** (T-1) as the _only_ analysis lane. The MVP is
  permanently cold-start; the Batch lane arrives with scale, not before.
- **Tenancy discipline** (§9 of the architecture): org-scoped everything,
  no id-only mutations, write-key ingest attribution. Retrofitting tenancy is
  the one debt that is never cheap later.
- **MCP, read-only subset:** `list_open_fixes`, `get_fix`, `get_finding`.
  A minimal fix spec (structured state → plain-sentence rendering, no code)
  so step 4 of onboarding is real and "Get it fixed" leads somewhere.

**In, but deliberately thin:**

- **Surfaces are URL paths**, not code-derived nodes. Good enough for signatures
  and for addressing findings; the ts-morph derivation replaces it later without
  changing the signature scheme (surface-id ancestry, absorbs the swap).
- **Exclusions run at the adapter**, not at capture, because capture is
  PostHog's. Internal-domain and bot filtering happen on pull, with the same
  declared fail directions (§4 / of the architecture). The free-mail guard
  on domain inference applies from day one.
- **T1 detection on events only:** failed requests, error events, rage clicks,
  dead clicks, funnel drop-off on path transitions. No recording analysis in
  the scoring tier.

**Out, with the milestone that brings each back:**

| Cut                                                                     | Returns in                                                                   |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| First-party event package (`packages/sdk-js`)                           | M5 equivalent — unless the M-0 spike forces the minimal capture path early   |
| Full taxonomy derivation (ts-morph, merge webhooks, event↔line mapping) | M1 proper                                                                    |
| Batch API lane, metering, degrade-sampling, billing                     | With real volume                                                             |
| Experiments, power checks, surface locks, verification, verdicts        | M3                                                                           |
| Simulation, personas, calibration                                       | M4                                                                           |
| Recording replay clips in findings                                      | When M-0 shows recordings land fast enough, or with first-party capture      |
| Second `SessionSource` adapter (Amplitude, Mixpanel)                    | When a customer asks                                                         |
| Export endpoint, kill switch UI                                         | Before first external self-hoster; the _schema_ for both exists from day one |

## 5. Pipeline shape

The full architecture's funnel, with the MVP lanes chosen:

```
PostHog (their project)
  → SessionSource adapter (pull; exclusions + fail directions here)
  → T1 detect (pure functions over events; SQL scoring)
  → synchronous skim/read (cold-start lane only — no batch)
  → evidence gate (downgrade or reject; §6 three-way split)
  → signature ledger (never twice, dismissed forever)
  → delivery scheduler (one open finding, nothing-today)
  → onboarding push (first-run only) + Slack message (steady state)
```

One port, one implementation. `SessionSource` is defined in `packages/adapters`
exactly as §4.3 specifies; PostHog is its only implementation until a customer
forces a second. No adapter registry, no plugin machinery, the interface
existing is what protects extensibility, and a speculative second implementation
is just maintenance.

## 6. Commitments that still bind at MVP scale

Thinning scope does not thin these:

- **§6 evidence:** every summary carries confidence, sample size, denominators,
  and only claims what a predicate proved. A `broken` claim needs the failed or
  absent request, or it degrades to `confusing`.
- **§7 backpressure:** one finding at a time from the very first user. The MVP
  never posts two.
- **§5 PII:** PostHog masking config is verified during onboarding step 2.
  Generated finding text must pass the residual scanner before it is pushed or
  posted, **a requirement the MVP has not met yet.** ships the first
  model-written text and guards it for assertion accuracy, not for residual
  personal data; wiring `scanResidualPii` over that text is SAC-9's promotion and
  is owed before delivery goes live. No recording clip ships in the MVP, which
  shrinks this surface to text.
- **§10 language:** plain English, no jargon, counts with denominators, in the
  onboarding push and the Slack message equally.
- **§11 source of truth:** the MVP is _born_ compliant. It runs entirely off a
  third-party source and stores only derived state.
- **§12 cost:** the synchronous lane has a hard per-project cap, exactly as T-1
  specifies. The MVP never runs a model over every event.

## 7. Deviations on the record

Three, each scoped and with an expiry:

1. **An in-app summary surface exists** (onboarding push). Deviation from §10's
   non-dashboard rule, scoped to first-run: the surface appears during
   onboarding only, is never linkable back to, and holds no history. Expiry:
   never expands; anything resembling a findings list in the app is a design
   bug per.
2. **Findings are pushed to a screen before Slack is verified.** If Slack
   connection (step 3) is skipped, the onboarding moment still works, but the
   product states plainly that nothing further will arrive until Slack is
   connected, an honest degraded mode, not a silent one.
3. **No taxonomy means §2/§3 are dormant** (events tied to code lines, drift
   detection). Dormant, not violated, PostHog event names are used as-is and
   never re-authored, so no second source of truth is created. Expiry: M1
   proper.
4. **The 5–20 second promise is withdrawn and replaced by a measured bar.**
   §3 called it "the riskiest assumption in this document"; M-0 (O-001) ran and
   it does not hold. The decomposition: PostHog's own event-leg p90 is ~24 s
   (decision 0001), the poll adds 15–60 s, and `analysis:tick` is an hourly cron
   with no event trigger — that term alone is ~180× the whole budget.
   **Ruled:** the ~24 s third-party leg is _accepted_ as inherent variance. The
   two terms that are ours are _fixed_ — an onboarding-scoped fast analysis path
   that reuses the existing lane and **respects the single-writer index and the
   cap ledger, or it does not ship** (a cap-bypassing trigger is a cost
   incident, not an optimisation). Internal design target ~25–35 s, **never
   rendered as copy**: the waiting state narrates what is happening and shows
   elapsed actuals, and never promises a number or runs a countdown it cannot
   keep. §8's "within 20 seconds" is replaced by the same measured bar.
   **§3's second branch does not fire** — no first-party capture, no rrweb, no
   capture code. It stays on the record as the named trigger if real testers
   turn out not to be glued at the measured latency. Expiry: this deviation ends
   when a tester says the wait broke the moment, at which point §3's fallback is
   the pre-decided answer rather than a fresh debate.

## 8. Done when

- A fresh user completes onboarding steps 1–4 in under ten minutes without help.
- They trigger a real failure in their own product and the summary lands on the
  onboarding screen **while they are still standing on it**, evidence attached,
  class named, and the **observed p50/p90 recorded** (§7 deviation 4 — the bar
  is measured, not softened; swapping one aspirational integer for a larger one
  is what produced the amendment).
- The same finding arrives in Slack, renders inside the legibility budget, and
  a second identical failure that day produces **no** second message.
- "Not useful" suppresses the signature permanently; "Get it fixed" yields a
  fix spec their coding agent can read over MCP.
- `bun run typecheck && bun test && bun run build` green; every pure function
  in the pipeline (detectors, gate predicates, signature, renderer) has unit
  tests with declared fail directions.
