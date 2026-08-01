# Growthmind: Get Started — The First Ten Minutes

> Companion to [`mvp.md`](mvp.md). That document decides _which_ pieces exist
> first; this one describes what those pieces must **feel like** on first run —
> the experiential contract the MVP build is held to, beat by beat. It is
> extracted from the public `/get-started` page on growthmind.ai, where the same
> script plays as an animated film. The page states publicly that its figures
> are illustrative and that the push must land while the founder is still on the
> screen; this document is where the build answers for that.

---

## 1. The contract in one line

**Break your product. Don't look away.**

A founder connects five things, breaks their own product on purpose, and before
they have gone looking for something else to do, the screen they are still
standing on names the failure — with the evidence attached. Everything below is
the script of that experience. The hypothesis it tests is
[`mvp.md` §1](mvp.md#1-the-glue-moment): a founder who is still there when it
lands is glued. That is the whole bar, and it is deliberately not a number —
we measure what the wait actually costs and we promise nobody a clock
([`mvp.md` §7 deviation 4](mvp.md#7-deviations-on-the-record)).

## 2. The timeline

The film runs ten beats. The order is the contract and the clock is not — each
confirmation must land while the user is still looking at the step that produced
it, and the finding must land while they are still standing on the screen that
started the wait.

| Beat | What happens                                                      | What it proves                                       |
| ---- | ----------------------------------------------------------------- | ---------------------------------------------------- |
| 1    | Repo connected, read-only                                         | Context, not surveillance                            |
| 2    | PostHog linked — the project they already run                     | The event counter ticks, so the connection is real   |
| 3    | Slack connected                                                   | The test message lands before they switch back       |
| 4    | Coding agent shakes hands over MCP                                | `list_open_fixes → 0 open` — empty, but valid        |
| 5    | They break their own product — a save that fails. No ticket filed | Step five is the demo of the product                 |
| 6    | The screen they are standing on starts counting                   | The armed step-five row counts up where they can see |
| 7    | **Still there.** What happened, to whom, with proof               | The glue moment                                      |
| 8    | The same finding arrives in Slack                                 | Steady state — the screen never asks them back       |
| 9    | They break it again. Nothing posts twice                          | The signature ledger remembers                       |
| 10   | "Get it fixed" is a spec their agent can read                     | Hypothesis: they're glued                            |

The five setup steps and their confirmations are specified in
[`mvp.md` §2](mvp.md#2-onboarding-flow); this table adds the pacing and the
proof each beat must deliver on screen.

## 3. The surfaces

Five surfaces appear in the first ten minutes. Each exists for one reason.

**The terminal** — `npx growthmind init`. One command; each onboarding step
prints its confirmation as it proves itself:

```
✓ repo connected · read-only · branch: main
✓ posthog linked · yourapp-prod · what we collect, on the record
✓ slack connected · #growth · test message delivered
✓ mcp installed · list_open_fixes → 0 open · valid
● your turn — trigger an issue in your product
```

Note the second line. Step two claims nothing has been checked inside your
capture config, because there is no capture code of ours to check —
`packages/sdk-js` is a stub and stays one at MVP scale
([`mvp.md` §4](mvp.md#4-what-is-in-what-is-out)). What step two shows instead is
a **read-only receipt** of what we do and do not collect: page addresses kept as
tidied-up patterns rather than raw ones, whose visits are set aside and where
that guess came from, the direction we fail in when we cannot tell (we keep the
visit), identity stored as a one-way stand-in, no bag of event properties at
all, and every outbound message checked for leftover personal detail before it
leaves. Nothing on it is a setting, and there is nothing to switch on.

That is the §5 PII commitment surfaced during onboarding exactly as
[`mvp.md` §6](mvp.md#6-commitments-that-still-bind-at-mvp-scale) requires, and
it is the honest version of it: a receipt states what is already true and can be
proved, where a confirmation implies work this build has not done.

**The first-run console** — `FIRST-RUN · LIVE · READ-ONLY`. A five-row
checklist where each row carries its own proof (`main · read-only`,
`events ticking`, `#growth · test ✓`, `0 open fixes`), a live `events seen`
counter that visibly ticks (step two's confirmation), and — once step five is
armed — a watching row whose elapsed count ticks up (`your move` →
`watching · +3s` → `watching · +8s`, a stopwatch and never a countdown)
and a raw evidence feed as the failure is captured:

```
s12 · click 'Save changes' · POST /api/settings · 500
s12 · retried twice · 500 × 3
proof secured · the failed request itself · 3 of 3
```

This surface is the on-record deviation from the non-dashboard rule
([`mvp.md` §7.1](mvp.md#7-deviations-on-the-record)): it exists once, during
install, and retires with onboarding. The finding card says so in its own
copy: _"This screen retires with onboarding."_

**Their product** — not ours. The broken save is triggered in the user's own
app (a settings form whose save returns 500 and shows "Something went wrong.
Try again."). Growthmind never simulates the failure; the user causes it.

**Slack** — the steady state. See §4 for the canonical message.

**The coding agent** — the MCP handshake in step four, and the fix-spec pull
in beat ten. See §5.

## 4. The finding — canonical copy

This is the legibility budget ([product-decisions §10](product-decisions.md))
made concrete. The renderer and its tests should be held to this register —
plain English, counts with denominators, the claim tied to its proof.

**Pushed to the first-run screen while they are still on it, class `BROKEN`:**

> **Saving workspace settings is broken.**
>
> 3 of 3 save attempts since 04:55 failed — POST /api/settings returned 500
> every time.
>
> Seen in 1 of 1 sessions this hour. Called broken because the failed request
> is on file — **not a guess**.

**Delivered to Slack (steady state):**

> Saving workspace settings is **broken**. 3 of 3 attempts in the last minute
> failed — the save request came back with an error every time
> (POST /api/settings → 500).
>
> 1 of 1 sessions this hour hit it. First seen 04:55.
>
> `[Get it fixed]` `[Not useful]`

What the copy demonstrates, deliberately:

- **Honest first-session denominators.** `3 of 3`, `1 of 1` — small numbers
  stated plainly, never dressed up. The evidence gate's sample size travels
  with the claim.
- **The class is earned.** `broken` is claimed because the failed request is
  on file — the §6 three-way split (evidence gate) rendered as a sentence a
  founder can audit.
- **Two actions only.** "Get it fixed" leads to the fix spec; "Not useful"
  suppresses the signature permanently ([`mvp.md` §8](mvp.md#8-done-when)).

**The suppression line (beat nine)** — when the identical failure happens
again, nothing posts, and the ledger says why in one line:

> 05:58 · same signature · 9f2c · nothing new posted

Never-twice is not silent: the first-run surface shows the suppression once,
so the user learns the guarantee exists. In steady state it simply never
posts.

## 5. The agent handshake

Step four's confirmation is an **empty-but-valid** response — the handshake
proves the wire works before there is anything on it:

```
> list_open_fixes
0 open · valid
```

Beat ten closes the loop. After "Get it fixed", the agent pulls:

```
> list_open_fixes
1 open · fix-001 · saving workspace settings fails

> get_fix fix-001
Every save posts to /api/settings, and every attempt since 04:55 came back
500. Start at the settings handler — requests fail before anything is written.
```

The spec is plain sentences an agent can act on and a founder can read over
its shoulder — the MVP's minimal fix spec (structured state rendered as
sentences, no code), per [`mvp.md` §4](mvp.md#4-what-is-in-what-is-out). The
MCP surface behind it is the read-only subset: `list_open_fixes`, `get_fix`,
`get_finding`. §6 is how you wire it up today.

## 6. Connect your coding agent

Beat four is the handshake and beat ten is the payoff. This section is the part
a developer actually types, and it takes about a minute.

The one-command installer in §3 (`npx growthmind init`) is the shape the setup
is being built toward, not something you can run yet. What exists today is
below, and it works.

### Mint a key

This surface reads with a key you mint yourself. There is no key-management
screen yet — it is one command, run from the repo root against a started stack:

```bash
bun scripts/mint-api-key.ts --name "claude code"
```

It prints the key once and writes it to no file, so copy it before you close the
terminal. Add `--org <id-or-slug>` if you belong to more than one organisation;
with more than one it refuses to guess and names your options instead. Revoke
with `bun scripts/revoke-api-key.ts --key-id <id>`, and the very next request
presenting that key is refused — nothing about a key is cached.

### Point Claude Code at it

```bash
claude mcp add --transport http growthmind http://localhost:3000/api/mcp \
  --header "Authorization: Bearer gmak_your_key_here"
```

Then `claude mcp list` prints:

```
growthmind: http://localhost:3000/api/mcp (HTTP) - ✔ Connected
```

Swap in your deployed URL when you have one. Add `--scope user` to keep the
entry in your own config instead of this project's.

### Or check it in, as a file

A `.mcp.json` at the repo root does the same for everyone who clones it, with
the key read from the environment rather than committed:

```json
{
  "mcpServers": {
    "growthmind": {
      "type": "http",
      "url": "http://localhost:3000/api/mcp",
      "headers": { "Authorization": "Bearer ${GROWTHMIND_API_KEY}" }
    }
  }
}
```

> **`"type": "http"` is not optional, and omitting it is the likeliest way a
> first attempt fails.** An entry with a `url` and no `type` is read as a local
> command to launch, so the server is skipped entirely:
>
> ```
> MCP server "growthmind" has a "url" but no "type"; add "type": "http" (or "sse" / "ws") to this entry
> ```
>
> A server declared in `.mcp.json` also needs approving once — run `claude` in
> the project and accept it, or it sits at "Pending approval".

### The three tools, in plain English

All three read. Nothing here changes anything, in your product or in ours.

| Tool              | What it is for                                                                                                                                                                                                                                                                                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_open_fixes` | The problems waiting to be fixed, most urgent first. Start here when you have been asked to improve something and hold no id. Each entry carries an id, one line on what is wrong, how many sessions hit it out of how many were measured, and when its result is due. At most 25 entries, plus the total, so a bigger total means you are looking at the most urgent slice. |
| `get_fix`         | The full instructions for one fix, by id: what is wrong and where, why it matters, the checks it will be judged on, when to stop early. It names files and states what should be true when you are done — it contains no code, and how to get there is yours.                                                                                                                |
| `get_finding`     | The evidence behind one problem, by id: what happened, how many sessions hit it out of how many were measured, over what dates, and links to the recordings and requests that show it. Everything in it was observed, never inferred.                                                                                                                                        |

Ask for an id that does not exist and you get the same sentence as an id
belonging to someone else — that is deliberate, and there is no way to tell the
two apart.

### You do not configure the protocol

A stock MCP client — one built with no options at all — connects on the legacy
protocol revision `2025-11-25` through the usual `initialize` handshake, and
needs nothing set. Claude Code is one of those: measured against this endpoint,
it sends `"protocolVersion":"2025-11-25"`. A client pinned to the modern
`2026-07-28` revision is served by the same endpoint, on the same URL, with the
same three tools. You do not pick one; the endpoint answers both.

### What comes back today: nothing, and it says so

There is no table of findings behind these tools yet — that is a separate piece
of work — so every answer is honestly empty rather than absent. `list_open_fixes`
returns an empty list with a truthful window:

```json
{
  "fixes": [],
  "window": { "returned": 0, "totalOpen": 0, "truncated": false }
}
```

and both id lookups answer exactly as they would for an id that never existed:

> There is nothing here with that id. Call list_open_fixes to see the ids you
> can ask about.

**That is the correct answer, not a placeholder that will fill itself in.** An
empty list rather than an error, a count of `0 of 0` rather than a blank, and a
"not found" that reads the same however you got there — that is what this
surface is held to when it has nothing to say. It will have something to say
when findings exist; until then, do not read the empties as a connection
problem.

## 7. What the public page promises

The `/get-started` page is a public commitment, and it is careful about three
things this build must keep true:

1. **The figures are illustrative, and so is the pacing.** The page commits to
   no push window at all. The M-0 spike
   ([`mvp.md` §3](mvp.md#3-the-gating-spike--run-before-anything-is-built)) ran
   and the committed one did not survive it, so
   [`mvp.md` §7 deviation 4](mvp.md#7-deviations-on-the-record) withdrew it: a
   third party's own leg is outside our control, the two terms that are ours are
   fixed, and what we owe a reader is the measured result rather than a promise
   made before the measurement. What the page does promise is the shape of the
   moment — the finding lands while the founder is still on the screen.
2. **"Open source and built in the open, so you can hold us to it."** The page
   invites scrutiny of exactly the commitments in
   [`mvp.md` §6](mvp.md#6-commitments-that-still-bind-at-mvp-scale).
3. **Read-only, stated everywhere.** The repo connection says it, the console
   banner says it, the MCP subset enforces it. §1's read-only rule is visible
   copy, not a footnote.

## 8. Done when, experientially

[`mvp.md` §8](mvp.md#8-done-when) states the acceptance criteria; this film
adds the register they must be experienced in:

- Every setup step's confirmation is **visible and specific** — a branch name,
  a ticking counter, a test message, an empty-but-valid response. "Connected"
  with no proof is a bug.
- The step-five wait is **watched, not spun** — the surface shows elapsed time
  counting up and the evidence feed as it captures, so the wait reads as work
  being done instead of as silence. It never shows a countdown, a bar or a
  figure it would have to keep.
- The finding lands **on the screen the user is standing on**, then in Slack,
  in the same plain-English register — one output, two audiences.
- The second identical failure produces **one visible suppression line** on
  the first-run surface and nothing anywhere else.
