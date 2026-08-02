<p align="center">
  <img src=".github/assets/icon.svg" width="72" height="72" alt="Growthmind" />
</p>

<h1 align="center">Growthmind</h1>

<p align="center"><strong>Build a product people actually use, then use again.</strong></p>

<p align="center">
  <a href="https://growthmind.ai">growthmind.ai</a> ·
  <a href="https://growthmind.ai/pricing">pricing</a> ·
  <a href="docs/product-decisions.md">product decisions</a> ·
  <a href="docs/architecture.md">architecture</a> ·
  <a href="docs/reliability-checklist.md">reliability checklist</a>
</p>

<p align="center">
  <a href="https://github.com/growthmind-ai/growthmind/actions/workflows/ci.yml"><img src="https://github.com/growthmind-ai/growthmind/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="Licence: MIT" /></a>
</p>

---

Anyone can ship a product now. A coding agent will build whatever you describe. What it won't tell you is why nobody finishes your onboarding, why they never come back, or what your ICP actually needed instead, and no dashboard tells you either, because dashboards only describe users you already lost, to whoever remembers to check them.

Growthmind is an open-source growth engine that closes that gap. It watches real people use your product, finds where they get stuck, and tells you. One finding at a time, in Slack, with the session recording and the numbers attached. Then it finishes the job: the fix gets specced for the coding agent you already use, verified once it ships, measured against a criterion set in advance, and closed with a straight answer, **keep, kill, or inconclusive**.

> **Status: pre-release, and the loop below does not close yet.**
>
> **Runs today.** Signup into an org, a five-step first run, PostHog and Slack
> connected and stored encrypted. The worker polls sessions, runs two detectors
> (funnel drop-off and error events) through an evidence gate, persists findings
> behind a signature ledger that never repeats one and remembers a dismissal,
> renders a summary — with a model when a key is configured, and a deterministic
> floor when not — and posts to Slack on a schedule.
>
> **Does not run.** `packages/sdk-js` is a stub, so there is no first-party
> capture, no auto-derived events, and no masking — everything above depends on
> your PostHog. There is no ingest endpoint. Experiments, verification and
> verdicts are specified and unbuilt. The MCP surface authenticates and serves
> its three read tools, but is wired to a placeholder read port and answers empty
> on every installation, including ones with findings.
>
> This README describes what Growthmind is for. The two lists above are what you
> can run this afternoon.

## What a finding looks like

> **People who try to invite a teammate can't. The invite never sends.**
>
> 🎬 _0:06, names and text hidden_
>
> `Broken` · `51 of the 340 who got this far`
>
> Fix the invite request so it actually sends.
> If this is the only thing stopping them, about 1 in 8 more would finish setup.
>
> **[Get it fixed]** · [Not useful]

No dashboard. No ranked list of twelve things. No new vocabulary to learn. One message, fully legible without clicking anything, evidence attached, dismissible, and a dismissal is remembered.

## The loop

| Step          | What happens                                                                                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Found**     | Real sessions are skimmed cheaply; one properly read when something looks wrong. The finding arrives with recording, count, and estimated worth                       |
| **Specced**   | The fix becomes a plain-English spec with verification criteria, a stop rule, and a readout date — set before it runs, never moved after                              |
| **Simulated** | A simulated customer runs the flow before real users meet the change                                                                                                  |
| **Shipped**   | Dispatched to _your_ coding agent (Claude Code, Cursor, Copilot) via MCP. Growthmind never writes code — read-only repo access is sufficient for the entire core loop |
| **Measured**  | The agent's "done" is a claim, not a fact. Growthmind verifies independently: code present, flag live, events firing. Then the clock starts                           |
| **Verdict**   | Every experiment terminates: keep, kill, or inconclusive. Zero orphans. Dead ideas are never proposed again                                                           |

## What makes it different

These are commitments from the [product decisions](docs/product-decisions.md). The document this codebase is built against:

- **A real finding within 24 hours of install.** A number we hold ourselves to.
- **No tracking plan, no taxonomy, no activation definition up front.** Events are auto-derived from your codebase, tied to a line of code, and re-derived on every merge, so drift is impossible by construction, not by discipline.
- **Silent instrumentation death is treated as the top threat.** An event that stops firing gets flagged before it quietly poisons every number built on it.
- **It refuses calls it cannot support.** Underpowered experiment? It says so instead of running it. No verdict beats a wrong verdict.
- **Backpressure is a feature.** One thing at a time, a hard ceiling on findings per week, and a "nothing worth telling you today" state that actually gets used.
- **Your internal traffic never counts.** Team accounts, bots, E2E runs, staging, and your own coding agents browsing the app are excluded automatically and retroactively, never a setup step.
- **No PII in the stream, provably.** Recordings are masked DOM reconstructions, masked at capture, before anything leaves the browser.
- **It never touches pricing, billing, auth, consent, or terms.** Ever. And it's killable in one action, with everything it did reversible and inspectable.
- **It works alongside your analytics** (PostHog, Amplitude, Mixpanel), never replaces them, never becomes a system of record you can't leave. Findings and history are exportable.
- **Cost is bounded, not linear in your traffic.** A deterministic pre-filter runs first; a model only ever sees what survives it. Token spend is visible before a run, not after.

## How it connects

```
your repo (read-only)  ─┐
your coding agent (MCP) ─┼─▶  Growthmind  ─▶  one Slack message at a time
your analytics          ─┘
```

An MCP server exists and speaks the wire protocol
([`apps/web/app/api/mcp/route.ts`](apps/web/app/api/mcp/route.ts)): a real client
handshakes, an API key is checked, and three read tools are advertised —
`list_open_fixes`, `get_fix`, `get_finding`. It is not useful yet. Those tools
are wired to a placeholder read port and return empty on every installation,
so an agent that connects sees nothing even where findings exist.

The rest is designed, not shipped ([architecture.md §7](docs/architecture.md#7-machine-surfaces)):
five tools in total, four reads and one write, where the write
(`report_shipped`) records a claim that only independent verification can turn
into a fact. A set of open skills (`growth-context`, `growth-events`,
`growth-experiments`, `growth-simulations`) teaches your agent to write
instrumentation and simulations as code, in your repo, reviewed like anything
else you ship. No skills directory exists here today.

## Run it

```bash
git clone https://github.com/growthmind-ai/growthmind.git
cd growthmind
docker compose up
```

That is the whole quickstart: Postgres (with pgvector), the app on
[localhost:3000](http://localhost:3000), and the worker. No.env, no signup,
no API key. CI boots this exact command from a clean clone on every push and
probes `/api/health`, the `compose` job in
[ci.yml](.github/workflows/ci.yml), so it can never silently break.

For development:

```bash
bun install                # bun 1.3+
docker compose up postgres # just the database
bun run dev                # app on :3000
bun run dev:worker         # worker, second terminal
```

## Contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md), and point your coding agent at
[AGENTS.md](AGENTS.md), the same conventions, written for the thing writing
the code. The short version: the
[product decisions](docs/product-decisions.md) are the contract this codebase
is built against, `bun run check` is the local gate, and if you think a
decision is wrong there is an issue template specifically for arguing with
it. [GOVERNANCE.md](GOVERNANCE.md) covers who decides, why there is no CLA,
and how to take a product decision apart. Security reports go through
[SECURITY.md](SECURITY.md), never a public issue.

## Status

**Early. Pre-release.** This repository is where the platform is being built in
the open. The [product decisions](docs/product-decisions.md), the
[architecture](docs/architecture.md) that enforces them, and the
[stack rationale](docs/stack.md) are settled and published in [`docs/`](docs/).
The full machine-surface contract is still a draft and graduates to `docs/` as
it is implemented. The implementation is landing now. The status note at the top
lists what runs and what does not, in both directions. Watch or star the repo to
follow along, and open an issue if you want to argue with a decision. That's
what publishing them is for.

- **Self-hosted**: free, no limits, and not a lesser tier. Every feature, no
  ceilings, your session data never leaves your infrastructure. You bring model
  keys, Postgres, and somewhere to run a container. It sends us nothing. No
  usage counters, no version pings, no opt-in switch to find.
  [How to verify that yourself](docs/telemetry.md).
- **Cloud**: the same thing, run for you. Findings and one active experiment are
  free forever; $20/mo is what running it for you costs beyond that. You are
  paying for the hosting, never for a feature we withheld,
  [growthmind.ai/pricing](https://growthmind.ai/pricing)

## License

[MIT](LICENSE), the code, and only the code. The name "Growthmind" and the
logo are not covered by it; there is a paid hosted service on the same name, so
the mark has to stay unambiguous. Fork it, rename it, run it commercially —
just don't present a fork in a way that implies affiliation with or endorsement
by Growthmind.
