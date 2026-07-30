# Growthmind: Get Started — The First Ten Minutes

> Companion to [`mvp.md`](mvp.md). That document decides _which_ pieces exist
> first; this one describes what those pieces must **feel like** on first run —
> the experiential contract the MVP build is held to, beat by beat. It is
> extracted from the public `/get-started` page on growthmind.ai, where the same
> script plays as an animated film. The page states publicly that its figures
> are illustrative and that the five-to-twenty-second push is the budget the
> build is held to; this document is where the build answers for that promise.

---

## 1. The contract in one line

**Break your product. Count to twelve.**

A founder connects five things, breaks their own product on purpose, and the
screen they are still standing on names the failure — with the evidence
attached — before they have finished counting. Everything below is the script
of that experience. The hypothesis it tests is [`mvp.md` §1](mvp.md#1-the-glue-moment):
a founder who watches this happen is glued.

## 2. The timeline

The film runs ten beats. Timecodes are illustrative; the intervals are not —
each confirmation must land while the user is still looking at the step that
produced it, and the finding push is bound by the 5–20 s budget
([`mvp.md` §3](mvp.md#3-the-gating-spike--run-before-anything-is-built)).

| Beat | tc    | What happens                                                              | What it proves                                        |
| ---- | ----- | ------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1    | 00:00 | Repo connected, read-only                                                 | Context, not surveillance                             |
| 2    | 01:04 | PostHog linked — the project they already run                             | The event counter ticks, so the connection is real    |
| 3    | 02:11 | Slack connected                                                           | The test message lands before they switch back        |
| 4    | 03:24 | Coding agent shakes hands over MCP                                        | `list_open_fixes → 0 open` — empty, but valid         |
| 5    | 04:55 | They break their own product — a save that fails. No ticket filed         | Step five is the demo of the product                  |
| 6    | 05:03 | The screen they are standing on starts counting                           | The armed step-five row visibly watches (+3 s, +8 s)  |
| 7    | 05:07 | **Twelve seconds.** What happened, to whom, with proof — while still there | The glue moment                                       |
| 8    | 05:31 | The same finding arrives in Slack                                         | Steady state — the screen never asks them back        |
| 9    | 05:58 | They break it again. Nothing posts twice                                  | The signature ledger remembers                        |
| 10   | 06:14 | "Get it fixed" is a spec their agent can read                             | Hypothesis: they're glued                             |

The five setup steps and their confirmations are specified in
[`mvp.md` §2](mvp.md#2-onboarding-flow); this table adds the pacing and the
proof each beat must deliver on screen.

## 3. The surfaces

Five surfaces appear in the first ten minutes. Each exists for one reason.

**The terminal** — `npx growthmind init`. One command; each onboarding step
prints its confirmation as it proves itself:

```
✓ repo connected · read-only · branch: main
✓ posthog linked · yourapp-prod · masking verified
✓ slack connected · #growth · test message delivered
✓ mcp installed · list_open_fixes → 0 open · valid
● your turn — trigger an issue in your product
```

Note the second line: **masking verified** is a step-two confirmation, not a
background job — the §5 PII commitment surfaces during onboarding, exactly as
[`mvp.md` §6](mvp.md#6-commitments-that-still-bind-at-mvp-scale) requires.

**The first-run console** — `FIRST-RUN · LIVE · READ-ONLY`. A five-row
checklist where each row carries its own proof (`main · read-only`,
`events ticking`, `#growth · test ✓`, `0 open fixes`), a live `events seen`
counter that visibly ticks (step two's confirmation), and — once step five is
armed — a watching row (`your move` → `watching · +3s` → `watching · +8s`)
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

**Pushed to the first-run screen (+12 s), class `BROKEN`:**

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
`get_finding`.

## 6. What the public page promises

The `/get-started` page is a public commitment, and it is careful about three
things this build must keep true:

1. **The figures are illustrative; the budget is not.** The film shows twelve
   seconds; the promise is the 5–20 s push window. The M-0 spike
   ([`mvp.md` §3](mvp.md#3-the-gating-spike--run-before-anything-is-built))
   decides whether the PostHog pull path can honour it.
2. **"Open source and built in the open, so you can hold us to it."** The page
   invites scrutiny of exactly the commitments in
   [`mvp.md` §6](mvp.md#6-commitments-that-still-bind-at-mvp-scale).
3. **Read-only, stated everywhere.** The repo connection says it, the console
   banner says it, the MCP subset enforces it. §1's read-only rule is visible
   copy, not a footnote.

## 7. Done when, experientially

[`mvp.md` §8](mvp.md#8-done-when) states the acceptance criteria; this film
adds the register they must be experienced in:

- Every setup step's confirmation is **visible and specific** — a branch name,
  a ticking counter, a test message, an empty-but-valid response. "Connected"
  with no proof is a bug.
- The step-five wait is **watched, not spun** — the surface shows elapsed time
  and the evidence feed as it captures, so the 5–20 s window feels short
  instead of silent.
- The finding lands **on the screen the user is standing on**, then in Slack,
  in the same plain-English register — one output, two audiences.
- The second identical failure produces **one visible suppression line** on
  the first-run surface and nothing anywhere else.
