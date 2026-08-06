# Growthmind: The Evidence Standard

> What has to be true before we are allowed to write "because".
>
> Counts say what happened. No number of them says why. This document is the standard a
> claim must meet before it may be published as an explanation, and the honest thing we
> publish instead when it cannot.
>
> These are commitments, not aspirations. A change to this document is a product decision.

## 1. The two grades, and why we never blur them

Every finding is published in one of two grades, and the grade is visible to the reader.

- **Explained** — "What happened, and why." We can name the cause and point at the moment
  in a recording that shows it.
- **Described** — "What happened, we can't yet say why." We can show what people did. We
  are not able to tell you the cause.

A described finding is not a failure. It is the product working. The alternative — dressing
a description in causal language because it reads better — is the single thing that would
make every other finding on the page worthless.

- Must never promote a finding to _explained_ to improve how a page reads.
- Must never use causal grammar ("because", "due to", "caused by") in a described finding.
- Must show the grade on the finding itself, not only in an aggregate line.

## 2. Why is a difference, not a description

A cause is not a richer account of the failure. It is the **difference between the people
who failed and the people who did not**, located at a specific moment.

A perfect recording of one person struggling supports description only. There is nothing to
contrast it against, so nothing in it can be shown to be the cause rather than a
coincidence.

- Every explanation must rest on a comparison between a failing cohort and a succeeding
  cohort on the same surface, in the same window.
- The two cohorts must be placed on a shared step spine, so there is a common moment at
  which they can be said to diverge.
- The divergence point — the first step at which the cohorts' behaviour differs — is the
  claim's anchor. An explanation with no divergence point is a description.

## 3. The five rungs

A finding climbs these in order. It is published at the grade of the highest rung it
reaches, and no higher.

1. **Capture** — the event stream, the session recording, and the context needed to segment
   them.
2. **Align** — every session placed on a step spine for its surface, and split into
   succeeded and failed cohorts matched on entry and intent.
3. **Signal** — the divergence point, and the evidence signals that characterise it.
4. **Prove** — a proof predicate for the claimed class, met at a stated magnitude threshold.
5. **Say** — prose that cites the beats it rests on.

Rungs 1 to 3 are measurement. Rung 4 is the gate. Rung 5 is language, and it comes last on
purpose — see §6.

## 4. What counts as proof

A claim proposes a class. The class is granted only if an admitted signal for that class is
present **and** meets its magnitude threshold. If it is not granted, the claim walks a
downgrade path rather than being published at the class it wanted.

| Class             | What it asserts                | Admitted proof                                      |
| ----------------- | ------------------------------ | --------------------------------------------------- |
| `broken`          | It does not work               | A failure correlated to the action that preceded it |
| `confusing`       | It works, people cannot use it | Struggle — repeated attempts, backtracking          |
| `changed_mind`    | It works, they chose not to    | A clean exit, with no failure or struggle present   |
| `instrumentation` | We cannot see it               | An observed rate far below the expected rate        |

- Must state the magnitude threshold for every admitted signal, and record when a claim
  passed _at_ the threshold rather than clear of it.
- `changed_mind` must be disqualified outright by the presence of any failure or struggle
  signal. "They decided against it" is never the fallback for "we did not detect anything".
- A claim that fails its predicate must downgrade (`broken` to `confusing`) or drop. It must
  never publish at the class it claimed.
- Every downgrade must be traced, so the path a claim took is inspectable after the fact.

## 5. Counts, and what they are counts of

- Every count must carry its denominator, and the denominator must be a population the
  customer confirmed — not everyone who loaded the page.
- Sessions belonging to the customer's own team, to bots, and to coding agents must be set
  aside from the denominator, and the number set aside must be published alongside it.
- An exclusion rule must fail toward including a session. Wrongly excluding a real customer
  erases the evidence behind a finding and looks like a product problem rather than a
  measurement one.
- No count may be produced by a language model. Numbers are attached from verified data
  after the prose is written.

## 6. The model writes; it does not decide

The model is the last rung, and it holds no authority over the four beneath it.

- Must not decide whether a problem is real, how severe it is, or how confident anyone
  should be. Those are settled by the gate before it is called.
- Must not write a number, a percentage, a date, or a time span.
- Must not write a confidence, certainty, likelihood, or severity word.
- Must not invent a cause, a fix, or anything the input does not state.
- Every causal claim it writes must cite the beats it rests on. A claim that cites nothing
  is dropped before publication, and the fact that a claim was dropped is shown to the
  reader.
- All input drawn from a customer's product is delimited as data and must never be treated
  as an instruction, whatever it appears to say.

## 7. What the reader can always do

- Open the recording behind any finding, at the moment the claim is about.
- See what we set aside, and why.
- See the claim we dropped, and that we dropped it.
- See our record: which calls played out the way we said, which did not, and which cannot
  be read yet — on the same page as the claims themselves.

A track record published beside the claims is what makes the claims worth reading. It is
the only line on the page that prices our own credibility, and it is not optional.

## 8. Withholding

A finding whose recording cannot be masked confidently is not published. It is counted, and
the reader is told it exists and why it is not shown.

- Must scan for residual identifying data after masking and before any delivery.
- Must never publish a partially masked recording on the grounds that the finding is
  valuable.
- Must state the number withheld, so the count of findings still reconciles.

## Related

- [`AGENTS.md`](../AGENTS.md) — the product commitments this standard serves.
- [`architecture.md`](architecture.md) — how the pipeline is built.
- [`telemetry.md`](telemetry.md) — what is captured, and how it is named.
