<p align="center">
  <img src="https://growthmind.ai/icon.svg" width="72" height="72" alt="Growthmind" />
</p>

<h1 align="center">Growthmind</h1>

<p align="center"><strong>Build a product people actually use — then use again.</strong></p>

<p align="center">
  <a href="https://growthmind.ai">growthmind.ai</a> ·
  <a href="https://growthmind.ai/pricing">pricing</a> ·
  <a href="docs/product-decisions.md">product decisions</a>
</p>

---

Anyone can ship a product now. A coding agent will build whatever you describe. What it won't tell you is why nobody finishes your onboarding, why they never come back, or what your ICP actually needed instead — and no dashboard tells you either, because dashboards only describe users you already lost, to whoever remembers to check them.

Growthmind is an open-source growth engine that closes that gap. It watches real people use your product, finds where they get stuck, and tells you — one finding at a time, in Slack, with the session recording and the numbers attached. Then it finishes the job: the fix gets specced for the coding agent you already use, verified once it ships, measured against a criterion set in advance, and closed with a straight answer — **keep, kill, or inconclusive**.

## What a finding looks like

> **People who try to invite a teammate can't. The invite never sends.**
>
> 🎬 *0:06 — names and text hidden*
>
> `Broken` · `51 of the 340 who got this far`
>
> Fix the invite request so it actually sends.
> If this is the only thing stopping them, about 1 in 8 more would finish setup.
>
> **[Get it fixed]** · [Not useful]

No dashboard. No ranked list of twelve things. No new vocabulary to learn. One message, fully legible without clicking anything, evidence attached, dismissible — and a dismissal is remembered.

## The loop

| Step | What happens |
|---|---|
| **Found** | Real sessions are skimmed cheaply; one properly read when something looks wrong. The finding arrives with recording, count, and estimated worth |
| **Specced** | The fix becomes a plain-English spec with verification criteria, a stop rule, and a readout date — set before it runs, never moved after |
| **Simulated** | A simulated customer runs the flow before real users meet the change |
| **Shipped** | Dispatched to *your* coding agent (Claude Code, Cursor, Copilot) via MCP. Growthmind never writes code — read-only repo access is sufficient for the entire core loop |
| **Measured** | The agent's "done" is a claim, not a fact. Growthmind verifies independently: code present, flag live, events firing. Then the clock starts |
| **Verdict** | Every experiment terminates: keep, kill, or inconclusive. Zero orphans. Dead ideas are never proposed again |

## What makes it different

These are commitments from the [product decisions](docs/product-decisions.md) — the document this codebase is built against:

- **A real finding within 24 hours of install.** A number we hold ourselves to.
- **No tracking plan, no taxonomy, no activation definition up front.** Events are auto-derived from your codebase, tied to a line of code, and re-derived on every merge — so drift is impossible by construction, not by discipline.
- **Silent instrumentation death is treated as the top threat.** An event that stops firing gets flagged before it quietly poisons every number built on it.
- **It refuses calls it cannot support.** Underpowered experiment? It says so instead of running it. No verdict beats a wrong verdict.
- **Backpressure is a feature.** One thing at a time, a hard ceiling on findings per week, and a "nothing worth telling you today" state that actually gets used.
- **Your internal traffic never counts.** Team accounts, bots, E2E runs, staging, and your own coding agents browsing the app are excluded automatically and retroactively — never a setup step.
- **No PII in the stream, provably.** Recordings are masked DOM reconstructions, masked at capture, before anything leaves the browser.
- **It never touches pricing, billing, auth, consent, or terms.** Ever. And it's killable in one action, with everything it did reversible and inspectable.
- **It works alongside your analytics** (PostHog, Amplitude, Mixpanel) — never replaces them, never becomes a system of record you can't leave. Findings and history are exportable.
- **Cost is bounded, not linear in your traffic.** A deterministic pre-filter runs first; a model only ever sees what survives it. Token spend is visible before a run, not after.

## How it connects

```
your repo (read-only)  ─┐
your coding agent (MCP) ─┼─▶  Growthmind  ─▶  one Slack message at a time
your analytics          ─┘
```

Five MCP tools face your coding agent — four reads and one write, and the write (`report_shipped`) records a claim that only independent verification can turn into a fact. A set of open skills (`growth-context`, `growth-events`, `growth-experiments`, `growth-simulations`) teaches your agent to write instrumentation and simulations as code, in your repo, reviewed like anything else you ship.

## Status

**Early. Pre-release.** This repository is where the platform is being built in the open — the product decisions and machine-surface contracts are settled and published in [`docs/`](docs/); the implementation is landing now. Watch or star the repo to follow along, and open an issue if you want to argue with a decision — that's what publishing them is for.

- **Cloud**: findings free forever, experiments from $20/mo — [growthmind.ai/pricing](https://growthmind.ai/pricing)
- **Self-hosted**: free, no limits, your session data never leaves your infrastructure. You bring model keys, Postgres, and somewhere to run a container.

## License

[MIT](LICENSE)
