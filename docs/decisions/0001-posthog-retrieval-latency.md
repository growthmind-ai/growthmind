# Decision 0001: PostHog Retrieval Latency — Which SessionSource Ships First

**Status: BLOCKED-ON-CREDENTIALS** — no test PostHog project was available during the
sprint, so no measurement has run. Every number below is literally
`_pending measurement_`. Nothing here is estimated or fabricated; §7 explains how to
complete this document.

**Decides:** which `SessionSource` implementation the O-003 sprint builds first.
**Depends on:** the measurement harness at `scripts/spikes/m0-posthog-latency.ts`.
**Traces to:** mvp.md §3 (the gating spike M-0), outcome O-001.

---

## 1. What was measured & how

The harness measures how long freshly-captured PostHog data takes to become
**retrievable through PostHog's read APIs** — the same APIs a pull adapter would poll.
It measures a distribution across many trials, never a single best case.

**"Retrievable" per signal type:**

- **Custom event** — an event carrying this trial's unique marker property
  (`gm_spike_marker`) is returned by the PostHog events list API. In the same poll
  tick the harness also times a HogQL query (HogQL is PostHog's SQL-like query
  language — a second read path) so the two read paths can be compared.
- **Exception** — same protocol, for a `$exception`-shaped event (PostHog's standard
  exception event) captured via the plain capture API. If PostHog's read side does
  not surface `$exception` events for a test project, the declared fallback is a
  failed-request-shaped custom event named `gm_spike_failed_request` — and this
  section must then state which shape actually produced the numbers.
  Shape measured: `_pending measurement_`.
- **Session recording** — a recording is **listed** for the trial's distinct_id (the
  visitor identifier the trial sets to its unique marker) by the session-recordings
  list API. Listed, not playable: whether the replay renders is out of scope.
  Where the clock starts differs by mode: automated trials measure from the end of
  the roughly 15-second headless browser session to the recording being listed,
  while manual trials additionally include the operator's response time (the clock
  starts when the instructions are printed, before a person has opened the page).

**How the recording leg was driven:** either headless automation using a
Chromium-family browser already installed on the machine (Chrome/Edge/Chromium, with
the `CHROME_PATH` environment variable as an override), or the documented manual
fallback where a person interacts with the trigger page while polling stays
automated. Which mode ran, and the number of recording trials achieved:
`_pending measurement_`.

**Methodology:** at least 20 trials per signal type by default. Every trial embeds a
freshly-generated unique marker, and only an event or recording carrying **that
trial's** marker counts — so a trial can never accidentally match an earlier trial's
data and report a false near-zero time. Trials that never became retrievable within
the bounded poll timeout are counted in the totals as timed out, never dropped —
dropping them would bias the result toward the best case.

## 2. Results

_All cells pending — no run has occurred. Do not fill any cell by hand except by
pasting the harness's printed results block (see §7)._

**Plain-English key:** "p50" means half the trials were at or under this time.
"p90" means 9 out of 10 trials were at or under this time. "max" is the single worst
trial. Every count is shown with its denominator (e.g. "18 of 20 retrieved").

| Signal type | p50 | p90 | max | n attempted | n retrieved | n timed out or errored |
|---|---|---|---|---|---|---|
| Custom event | _pending measurement_ | _pending measurement_ | _pending measurement_ | _pending measurement_ | _pending measurement_ | _pending measurement_ |
| Exception | _pending measurement_ | _pending measurement_ | _pending measurement_ | _pending measurement_ | _pending measurement_ | _pending measurement_ |
| Session recording | _pending measurement_ | _pending measurement_ | _pending measurement_ | _pending measurement_ | _pending measurement_ | _pending measurement_ |

Run date/time: `_pending measurement_` · PostHog host region measured:
`_pending measurement_`

## 3. The branch taken, and why

**Branch taken: _pending measurement_.** No branch can honestly be named until the
table above holds real numbers. The rule that will decide it is fixed **now**, so
run-time doesn't improvise (from the sprint's architecture decision document, D-9):

> The branch is taken on the **event legs'** p90 (the glue moment rides events —
> mvp.md §3 explicitly lets the recording lag; the recording distribution feeds only
> the §4 cut-table row).
> - p90 ≤ 20 s → **PostHog pull adapter ships first** (`PostHogSessionSource` in
>   `packages/adapters`, per architecture §4.3 / mvp.md §5).
> - p90 ≥ 60 s → events take minutes; **minimal first-party capture (rrweb
>   events-only) ships first**, PostHog kept as historical/backfill source.
> - 20 s < p90 < 60 s (the awkward middle) → **pull adapter still ships first**, but
>   the doc must state the measured p90, note that the onboarding copy's promise must
>   stretch to the measured worst case or the poll design must compensate (tighter
>   interval, HogQL if faster per FR-10 data), and recommend a re-run before O-003
>   commits — named interpretation, no silent rounding.

In plain English: if 9 out of 10 fresh events show up through PostHog's API within
20 seconds, we build the PostHog adapter first. If they routinely take a minute or
more, we build our own minimal event capture first and keep PostHog as a source of
historical data. In between, the adapter still ships first but with the measured
number stated and its consequences named.

## 4. What ships first

**The `SessionSource` implementation that ships first is ___.**
_(Pending — fill from the rule in §3 once §2 holds real numbers.)_

## 5. Recording read-out vs the mvp.md §4 cut table

_Pending measurement._ The mvp.md §4 cut table holds the row **"Recording replay
clips in findings — when M-0 shows recordings land fast enough, or with first-party
capture"**. Once the recording row in §2 is filled, this section must give a
plain-English answer to: do recordings become listed fast enough to ever ship replay
clips inside findings? If the recording leg ran manually or with a small number of
trials, state that and what it limits.

## 6. Endpoint & rate-limit notes for O-003

**Not exercised — no credentials were provided during the sprint.** This section is
present-but-empty by design rather than silently absent.

When a run completes, record here:

- **Events API vs HogQL:** per trial, the harness times both read paths in the same
  poll tick and records which returned the fresh event first. Report which path
  surfaced fresh events sooner, with the observed difference and the number of trials
  it is based on — this feeds O-003's choice of polling endpoint.
- **Rate limits:** any HTTP 429 responses (PostHog telling the harness to slow down)
  encountered while polling, counted per trial, alongside the poll interval that was
  used — so O-003's polling design inherits the observed limits instead of
  rediscovering them.

## 7. How to complete this document (re-run instructions)

1. In a **test** PostHog project — the harness writes synthetic events — set the four
   `POSTHOG_*` variables in `.env`, following the comments in `.env.example`
   (`POSTHOG_HOST`, `POSTHOG_PROJECT_API_KEY`, `POSTHOG_PERSONAL_API_KEY`,
   `POSTHOG_PROJECT_ID`).
2. Run `bun scripts/spikes/m0-posthog-latency.ts` and let all three legs complete.
3. The harness prints a paste-ready results block on completion: paste it into §2 and
   §3 of this document (raw per-trial data also lands under `local/spikes/`, which
   stays out of git).
4. Fill in the exception shape and recording mode slots in §1, and §5/§6 from the
   same run output.
5. Apply the rule in §3 to the event legs' p90, name the branch taken, and complete
   the "ships first" sentence in §4.
6. Change the status line at the top from **BLOCKED-ON-CREDENTIALS** to **Decided**,
   with the run date.
