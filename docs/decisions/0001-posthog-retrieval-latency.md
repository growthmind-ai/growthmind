# Decision 0001: PostHog Retrieval Latency, Which SessionSource Ships First

**Status: Decided (2026-07-30)**, measured against a live test PostHog project on
the EU region. Every number below comes from the harness's printed results block;
raw per-trial data is in `local/spikes/run-2026-07-30T13-16-54.313Z.json` (out of git).

**Decides:** which `SessionSource` implementation the sprint builds first.
**Depends on:** the measurement harness at `scripts/spikes/m0-posthog-latency.ts`.
**Traces to:** mvp.md §3 (the gating spike M-0), outcome.

---

## 1. What was measured & how

The harness measures how long freshly-captured PostHog data takes to become
**retrievable through PostHog's read APIs**. The same APIs a pull adapter would poll.
It measures a distribution across many trials, never a single best case.

**"Retrievable" per signal type:**

- **Custom event**, an event carrying this trial's unique marker property
  (`gm_spike_marker`) is returned by the PostHog events list API. In the same poll
  tick the harness also times a HogQL query (HogQL is PostHog's SQL-like query
  language, a second read path) so the two read paths can be compared.
- **Exception**, same protocol, for a `$exception`-shaped event (PostHog's standard
  exception event) captured via the plain capture API. If PostHog's read side does
  not surface `$exception` events for a test project, the declared fallback is a
  failed-request-shaped custom event named `gm_spike_failed_request`, and this
  section must then state which shape actually produced the numbers.
  Shape measured: **the real `$exception` shape** (`$exception_list` carrying type
  and value). The `gm_spike_failed_request` fallback was **not** needed, PostHog's
  read side surfaced `$exception` events for the test project directly.
- **Session recording**, a recording is **listed** for the trial's distinct_id (the
  visitor identifier the trial sets to its unique marker) by the session-recordings
  list API. Listed, not playable: whether the replay renders is out of scope.
  Where the clock starts differs by mode: automated trials measure from the end of
  the roughly 15-second headless browser session to the recording being listed,
  while manual trials additionally include the operator's response time (the clock
  starts when the instructions are printed, before a person has opened the page).

**How the recording leg was driven:** no Chromium-family browser was available for
headless automation on the measuring machine, so the harness fell back to its
documented **manual** mode, printing trigger-page instructions and polling
automatically. **No operator performed the manual interaction during this run.**
20 trials were attempted; 0 recordings were ever created. See §5, this leg
measures operator absence, not PostHog's recording latency, and must not be read
as the latter.

**Methodology:** at least 20 trials per signal type by default. Every trial embeds a
freshly-generated unique marker, and only an event or recording carrying **that
trial's** marker counts, so a trial can never accidentally match an earlier trial's
data and report a false near-zero time. Trials that never became retrievable within
the bounded poll timeout are counted in the totals as timed out, never dropped —
dropping them would bias the result toward the best case.

## 2. Results

**Plain-English key:** "p50" means half the trials were at or under this time.
"p90" means 9 out of 10 trials were at or under this time. "max" is the single worst
trial. Every count is shown with its denominator (e.g. "18 of 20 retrieved").

| Signal type       | p50   | p90   | max    | n attempted | n retrieved | n timed out or errored |
| ----------------- | ----- | ----- | ------ | ----------- | ----------- | ---------------------- |
| Custom event      | 21.2s | 23.8s | 219.7s | 20          | 20 of 20    | 0                      |
| Exception         | 16.4s | 24.6s | 31.8s  | 20          | 20 of 20    | 0                      |
| Session recording | n/a   | n/a   | n/a    | 20          | 0 of 20     | 20 (see §1, §5)        |

Run date/time: `2026-07-30T13:16:54Z` · PostHog host region measured: `eu`

**Caveat that qualifies every number above:** the run absorbed **2,162 HTTP 429
(rate-limit) responses** across its 60 trials at a 1,000 ms poll interval. Time lost
to rate-limit backoff is _inside_ these latencies. The true ingestion-to-retrievable
latency is therefore **at or below** what this table reports, and a better-behaved
poller may see lower numbers. This does not change the branch taken (§3), it makes
the measured figures a conservative ceiling, but it is the main reason §3 recommends
a re-run before commits to a poll design.

## 3. The branch taken, and why

**Branch taken: the awkward middle (20 s < p90 < 60 s).** The event legs' p90 came in
at **23.8 s (custom events)** and **24.6 s (exceptions)**. Both above the 20 s
threshold and far below 60 s. The rule was fixed before the run (from the sprint's
architecture decision document, ):

> The branch is taken on the **event legs'** p90 (the glue moment rides events —
> mvp.md §3 explicitly lets the recording lag; the recording distribution feeds only
> the §4 cut-table row).
>
> - p90 ≤ 20 s → **PostHog pull adapter ships first** (`PostHogSessionSource` in
>   `packages/adapters`, per architecture §4.3 / mvp.md §5).
> - p90 ≥ 60 s → events take minutes; **minimal first-party capture (rrweb
>   events-only) ships first**, PostHog kept as historical/backfill source.
> - 20 s < p90 < 60 s (the awkward middle) → **pull adapter still ships first**, but
>   the doc must state the measured p90, note that the onboarding copy's promise must
>   stretch to the measured worst case or the poll design must compensate (tighter
>   interval, HogQL if faster per data), and recommend a re-run before
>   commits, named interpretation, no silent rounding.

In plain English: if 9 out of 10 fresh events show up through PostHog's API within
20 seconds, we build the PostHog adapter first. If they routinely take a minute or
more, we build our own minimal event capture first and keep PostHog as a source of
historical data. In between, the adapter still ships first but with the measured
number stated and its consequences named.

**The three consequences the middle branch obliges us to name:**

1. **The onboarding promise must stretch.** mvp.md §1 and §8 promise the summary
   lands "within 5–20 seconds"; §8 makes "within 20 seconds" an acceptance
   criterion, inherited by outcome. On this data that promise is **not
   achievable via the pull adapter**, not through any fault in our code, but
   because that is how fast PostHog's read side surfaces fresh data. Either the
   copy and the acceptance bar move to match measurement (the exception leg
   supports "typically under 20 seconds, occasionally up to ~30"), or step 5 of
   onboarding needs a designed waiting state honest about the tail. **This is an
   open product decision, not something this document settles.**
2. **The exception leg is the one that matters, and it behaves well.** The glue
   moment fires on a failed request or error, i.e. the exception leg: p50 16.4 s,
   p90 24.6 s, worst 31.8 s across 20 of 20 retrieved. Its tail is _tight_. The
   custom-event leg's 219.7 s worst case is the scarier number, but it is not the
   path the glue moment rides.
3. **Re-run before commits to a poll design**. The 2,162 rate-limit responses
   (§2, §6) mean this run measured a poller PostHog was actively throttling. A
   re-run at a compliant interval should precede freezing the adapter's polling
   strategy.

## 4. What ships first

**The `SessionSource` implementation that ships first is `PostHogSessionSource`**
(the pull adapter, in `packages/adapters`, per architecture §4.3 / mvp.md §5).

First-party rrweb capture is **not** built for the MVP. It returns post-MVP as the
mvp.md §4 cut-table row already anticipates ("First-party event package
(`packages/sdk-js`), M5 equivalent"), now with a measured reason rather than a
speculative one. Recorded product decision (Tom, 2026-07-30): stay on PostHog for
the MVP and add our own screen/session recording via rrweb after the MVP ships.

## 5. Recording read-out vs the mvp.md §4 cut table

**This run produced no usable recording data, and the reason is operator absence,
not PostHog latency.** The harness fell back to manual mode (no Chromium-family
browser for headless automation) and no person opened the trigger page during the
20 trials, so **no recording was ever created for the poller to find**. All 20
trials therefore hit the 120 s ceiling. Reading these timeouts as "PostHog
recordings are slower than 120 s" would be a fabrication. The correct reading is
"not measured."

The mvp.md §4 cut table row (**"Recording replay clips in findings) when M-0 shows
recordings land fast enough, or with first-party capture"**, is therefore
**unchanged and still cut**. Nothing here licenses shipping replay clips, and
nothing here rules them out.

This costs the MVP nothing: replay clips are already out of scope (mvp.md §4), and
architecture T-4 states a finding never waits for its clip. To close this properly,
re-run with `--legs recordings` on a machine with Chrome/Edge/Chromium installed
(or `CHROME_PATH` set), which exercises the automated path and removes the operator
from the measurement entirely.

## 6. Endpoint & rate-limit notes for

- **Events API vs HogQL. The events API wins decisively.** The events list API was
  the satisfying endpoint in **40 of 40** retrieved event trials. The HogQL `query`
  path hit the 120 s ceiling in all 40. It did not surface a single fresh event
  inside the poll window. ** should poll the events API for fresh-event
  detection and must not rely on HogQL for the hot path.** (HogQL may still suit
  historical/aggregate reads, which this run did not test.)
- **Rate limits, polling once per second is far too aggressive.** The run drew
  **2,162 HTTP 429 responses** across 60 trials at a `pollIntervalMs` of 1,000.
  the polling design must inherit this: back off substantially, honour
  `Retry-After`, and treat 429 handling as a first-class part of the adapter rather
  than an edge case. Note the circularity called out in §2. That throttling is
  itself baked into the latencies above.

## 7. How to complete this document (re-run instructions)

_Completed 2026-07-30. Retained for the re-runs §3 and §5 recommend._

1. In a **test** PostHog project (the harness writes synthetic events) set the four
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

---

## Addendum (2026-07-30): the live-API probe corrects §6's rate-limit conclusion

During sprint (`session-source-posthog-adapter`) a live-API shape probe ran
directly against the same PostHog project to pin the API contracts the adapter is
built on (endpoint shapes, pagination, error envelopes). One of its findings is a
material correction to this document's §6, recorded here per this doc's convention
of gaining dated addenda rather than being rewritten. **The original decision text
and Status above are unchanged**. Nothing here alters which `SessionSource` ships
first (§4).

**The rate-limit conclusion in §6 was misattributed to the wrong endpoint.** §6
reports 2,162 HTTP 429 responses across the M-0 run's 60 trials and treats rate
limiting as a property of the polled endpoints in general. The probe measured
each endpoint independently and found:

- **600 requests at 30-way concurrency to the events list API → zero 429s.**
- **600 requests to the HogQL query API → zero 429s.**
- Only `session_recordings` throttled, at roughly 100 requests per 60 seconds.
- Rate-limit buckets are **per-endpoint**, not per-project, throttling one
  endpoint does not throttle the others.

The M-0 run's recording leg polled 20 trials × 120 s ≈ 2,400 ticks, all of which
timed out (§5), against `session_recordings`, the one endpoint now known to
throttle at that volume. The 2,162 429s reported in §6 are almost certainly that
leg, not the events leg the adapter actually polls.

**Two consequences follow, both worth stating plainly:**

- The events list API (the adapter's hot path) is far more permissive than §6
  assumed. The poll interval does not need to be sized around a rate limit that was
  never measured on the hot path.
- More importantly, **the event legs' p90 of ~24 s (§2) should now be read as a
  real measurement, not a throttle-inflated conservative ceiling.** §2's caveat and
  §6 discounted the reported latencies on the grounds that PostHog was actively
  throttling the poller during the run. That discount does not apply to the events
  leg, it was never the leg being throttled. This _strengthens_ §3's conclusion
  that the 5–20 s onboarding promise is not achievable via the pull adapter: the
  number is not going to improve with a politer poller. This sharpens the open
  product question named in §3 rather than settling it. The copy and the
  acceptance bar remain owned elsewhere.

**`Retry-After` is now pinned.** On a 429, `Retry-After` is present and is always
**bare delta-seconds** (e.g. `59`), never an HTTP-date. It is the only rate-limit
header, there is no `X-RateLimit-Limit` / `-Remaining` / `-Reset`. The error body
is a stable typed envelope: `{"type":"throttled_error","code":"throttled","detail":…,"attr":null}`.

**Newly pinned facts bearing on §6's "poll the events list API" decision** (kept
brief here; each is load-bearing for the adapter's design, not just informational):

- Pagination walks **backwards in time**: `next` is an absolute URL carrying
  `before=<the page's last item timestamp>`, and that boundary is **exclusive**.
  Ordering is strictly newest-first across page boundaries. `next` is literal
  `null` on the final page. "fewer rows than the page limit" is not itself a
  signal that pagination is done.
- `after` and `before` are **both exclusive** of the boundary instant. A malformed
  time value returns **HTTP 200 with an empty result set** rather than a 4xx, an
  empty page can never be trusted as "caught up" unless the request's own
  parameters were validated first.
- The event `timestamp` is **client-declared event time**, not ingestion time —
  there is **no ingestion-time field** anywhere on the item, so ingestion lag is
  unobservable through this endpoint and completeness cannot be claimed from it.
- The event `id` is a stable, unique, server-assigned identifier, confirmed
  byte-identical across repeated retrievals. Sound as an idempotency key.
- `person` is **null on every events-list item**. The events API never joins the
  person object. An email is reachable only via a separate
  `GET /persons?distinct_id=` call, or from `$set`-bearing properties on
  identify-shaped events.
