# Growthmind: Get Started. The First Ten Minutes

> What the first run must **feel like**, beat by beat — the experiential
> contract the build is held to. Companion to
> [`AGENTS.md`](../AGENTS.md), which states what the product commits to; this
> one describes how those commitments land on a founder's screen. It is extracted from the public `/get-started` page on growthmind.ai,
> where the same
> script plays as an animated film. The page states publicly that its figures
> are illustrative and that the push must land while the founder is still on the
> screen; this document is where the build answers for that.

---

## 1. The contract in one line

**Break your product. Don't look away.**

A founder connects five things, breaks their own product on purpose, and before
they have gone looking for something else to do, the screen they are still
standing on names the failure — with the evidence attached. Everything below is
the script of that experience. The hypothesis it tests: a founder who is still
there when it lands is glued. That is the whole bar, and it is deliberately not
a number — we measure what the wait actually costs and we promise nobody a
clock.

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

This table is the contract for the five setup steps and their confirmations:
the order they run in, and the proof each beat must deliver on screen.

## 3. The surfaces

Five surfaces appear in the first ten minutes. Each exists for one reason.

**The terminal**, `npx growthmind init`. One command; each onboarding step
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
`packages/sdk-js` is a stub and stays one at this scale. What step two shows
instead is
a **read-only receipt** of what we do and do not collect: page addresses kept as
tidied-up patterns rather than raw ones, whose visits are set aside and where
that guess came from, the direction we fail in when we cannot tell (we keep the
visit), identity stored as a one-way stand-in, no bag of event properties at
all, and every outbound message checked for leftover personal detail before it
leaves. Nothing on it is a setting, and there is nothing to switch on.

That is the [no-PII commitment](../AGENTS.md) surfaced during
onboarding, and it is the honest version of it: a receipt states what is already
true and can be proved, where a confirmation implies work this build has not
done.

**The first-run console**, `FIRST-RUN · LIVE · READ-ONLY`. A five-row
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

This surface exists once, during install, and retires with onboarding. The
finding card says so in its own copy: _"This screen retires with onboarding."_

**Their product**, not ours. The broken save is triggered in the user's own
app (a settings form whose save returns 500 and shows "Something went wrong.
Try again."). Growthmind never simulates the failure; the user causes it.

**Slack**, the steady state. See §4 for the canonical message.

**The coding agent**, the MCP handshake in step four, and the fix-spec pull
in beat ten. See §5.

## 4. The finding, canonical copy

This is the legibility budget ([plain English, with denominators](../AGENTS.md))
made concrete. The renderer and its tests should be held to this register —
plain English, counts with denominators, the claim tied to its proof.

**Pushed to the first-run screen while they are still on it, class `BROKEN`:**

> **Saving workspace settings is broken.**
>
> 3 of 3 save attempts since 04:55 failed. POST /api/settings returned 500
> every time.
>
> Seen in 1 of 1 sessions this hour. Called broken because the failed request
> is on file, **not a guess**.

**Delivered to Slack (steady state):**

> Saving workspace settings is **broken**. 3 of 3 attempts in the last minute
> failed, the save request came back with an error every time
> (POST /api/settings → 500).
>
> 1 of 1 sessions this hour hit it. First seen 04:55.
>
> `[Get it fixed]` `[Not useful]`

What the copy demonstrates, deliberately:

- **Honest first-session denominators.** `3 of 3`, `1 of 1`, small numbers
  stated plainly, never dressed up. The evidence gate's sample size travels
  with the claim.
- **The class is earned.** `broken` is claimed because the failed request is
  on file, the §6 three-way split (evidence gate) rendered as a sentence a
  founder can audit.
- **Two actions only.** "Get it fixed" leads to the fix spec; "Not useful"
  suppresses the signature permanently.

**The suppression line (beat nine)**. When the identical failure happens
again, nothing posts, and the ledger says why in one line:

> 05:58 · same signature · 9f2c · nothing new posted

Never-twice is not silent: the first-run surface shows the suppression once,
so the user learns the guarantee exists. In steady state it simply never
posts.

## 5. The agent handshake

Step four's confirmation is an **empty-but-valid** response, the handshake
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
its shoulder — structured state rendered as sentences, no code. The tools
behind this beat are `list_open_fixes` and `get_fix`, with `get_finding` for the
evidence underneath. §6 is the full set and how you wire it up today.

## 6. Connect your coding agent

Beat four is the handshake and beat ten is the payoff. This section is the part
a developer actually types, and it takes about a minute.

The one-command installer in §3 (`npx growthmind init`) is the shape the setup
is being built toward, not something you can run yet. What exists today is
below, and it works.

### Mint a key

This surface reads with a key you mint yourself. Setup mints one for you: open
`/first-run`, pick your assistant, and press the button on the third step. It
shows the key once, hands you the config block for that assistant already
filled in, and marks the step done when your assistant first calls us. Revoking
is on the same screen.

If you have the repo checked out and a stack started, the same key is one
command:

```bash
bun scripts/mint-api-key.ts --name "claude code"
```

It prints the key once and writes it to no file, so copy it before you close the
terminal. Add `--org <id-or-slug>` if you belong to more than one organisation;
with more than one it refuses to guess and names your options instead. Revoke
with `bun scripts/revoke-api-key.ts --key-id <id>`, and the very next request
presenting that key is refused. Nothing about a key is cached.

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
> A server declared in `.mcp.json` also needs approving once. Run `claude` in
> the project and accept it, or it sits at "Pending approval".

### The tools, in plain English

Every one of them reads. Nothing here changes anything, in your product or in
ours.

| Tool                 | What it is for                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_open_fixes`    | The problems waiting to be fixed, most urgent first. Start here when you have been asked to improve something and hold no id. Each entry carries an id, one line on what is wrong, how many sessions hit it out of how many were measured, and when its result is due. At most 25 entries, plus the total, so a bigger total means you are looking at the most urgent slice.                                                                                                                                              |
| `get_fix`            | The full instructions for one fix, by id: what is wrong and where, why it matters, the checks it will be judged on, when to stop early. It names files and states what should be true when you are done — it contains no code, and how to get there is yours.                                                                                                                                                                                                                                                             |
| `get_finding`        | The evidence behind one problem, by id: what happened, how many sessions hit it out of how many were measured, over what dates, and links to the recordings and requests that show it. Everything in it was observed, never inferred.                                                                                                                                                                                                                                                                                     |
| `get_growth_context` | What a page is for in this business, and whether the people who own it have ruled it out of bounds for a coding agent. This is the one to call when nobody has handed you a fix and you are still deciding what to build. Name a page address for one page, or leave it out for the pages that matter here. You get back what the page is for, whether work on it is allowed and why not when it is not, the problems already known on it, and the ideas a person has already turned down so you do not raise them again. |

Both id lookups take an id you were handed rather than one you guess, and there
are two places to be handed one. Every entry `list_open_fixes` returns carries
its `findingId` alongside its `fixId`, so the queue hands you both. A problem
nobody has specced a fix for yet is not in that queue at all — it is in
`get_growth_context`, under `knownProblems`, where each entry carries a
`findingId` and a `fixId` that is null until one exists.

Ask for an id that does not exist and you get the same sentence as an id
belonging to someone else. That is deliberate, and there is no way to tell the
two apart.

### You do not configure the protocol

A stock MCP client (one built with no options at all) connects on the legacy
protocol revision `2025-11-25` through the usual `initialize` handshake, and
needs nothing set. Claude Code is one of those: measured against this endpoint,
it sends `"protocolVersion":"2025-11-25"`. A client pinned to the modern
`2026-07-28` revision is served by the same endpoint, on the same URL, with the
same tools. You do not pick one; the endpoint answers both.

### What comes back before you have findings

The tools read your organisation's own fixes. Until one exists, every answer is
honestly empty rather than absent. `list_open_fixes` returns an empty list with
a truthful window:

```json
{
  "fixes": [],
  "window": { "returned": 0, "totalOpen": 0, "truncated": false }
}
```

both id lookups answer exactly as they would for an id that never existed:

> There is nothing here with that id. Call list_open_fixes to see the ids you
> can ask about.

and `get_growth_context` says so in a field rather than by returning nothing,
so an agent can tell "nothing known here" apart from "the call failed":

```json
{
  "whatMatters": [],
  "knownProblems": [],
  "declined": [],
  "nothingKnownYet": true
}
```

**That is the correct answer, not a placeholder that will fill itself in.** An
empty list rather than an error, a count of `0 of 0` rather than a blank, and a
"not found" that reads the same however you got there. That is what this
surface is held to when it has nothing to say. It will have something to say
when findings exist; until then, do not read the empties as a connection
problem.

## 7. What the public page promises

The `/get-started` page is a public commitment, and it is careful about three
things this build must keep true:

1. **The figures are illustrative, and so is the pacing.** The page commits to
   no push window at all. The M-0 gating spike ran and the committed window did
   not survive it, so it was withdrawn: a third party's own leg is outside our
   control, the two terms that are ours are fixed, and what we owe a reader is
   the measured result rather than a promise made before the measurement. What
   the page does promise is the shape of the moment — the finding lands while
   the founder is still on the screen.
2. **"Open source and built in the open, so you can hold us to it."** The page
   invites scrutiny of exactly the commitments in [`AGENTS.md`](../AGENTS.md).
3. **Read-only, stated everywhere.** The repo connection says it, the console
   banner says it, the MCP subset enforces it. The read-only commitment is
   visible copy, not a footnote.

## 8. Done when, experientially

The acceptance criteria, in the register they must be experienced in:

- Every setup step's confirmation is **visible and specific**. A branch name,
  a ticking counter, a test message, an empty-but-valid response. "Connected"
  with no proof is a bug.
- The step-five wait is **watched, not spun** — the surface shows elapsed time
  counting up and the evidence feed as it captures, so the wait reads as work
  being done instead of as silence. It never shows a countdown, a bar or a
  figure it would have to keep.
- The finding lands **on the screen the user is standing on**, then in Slack,
  in the same plain-English register. One output, two audiences.
- The second identical failure produces **one visible suppression line** on
  the first-run surface and nothing anywhere else.
