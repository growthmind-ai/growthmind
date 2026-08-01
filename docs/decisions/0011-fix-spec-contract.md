# Decision 0011: A fix spec is fixed-template sentences, and it can never contain code

**Status: Decided.** Recorded 2026-08-01, extracted verbatim-in-substance from the
file header of `packages/core/src/fixes/fix-spec.ts` when long-form rationale moved to
docs.

**Decides:** what a rendered fix spec may contain, how the no-code guarantee is
enforced structurally, and the fail direction of every gate in the renderer.
**Implemented by:** `packages/core/src/fixes/fix-spec.ts`

---

## What is not true of this module, stated first

Nothing calls `renderFixSpec` in production. There is no MCP server in this repository
that invokes it, no worker task, no route, and no dispatch path. It is exercised by
its own test suite and by nothing else. No fix spec produced here has ever reached a
coding agent, or anyone.

There is no model. Nothing in `packages/core` imports `ai` or `@ai-sdk/anthropic`, and
the package cannot read an environment variable at all, having no node builtin in
reach. Every sentence is a fixed template with values written into it, so "did a model
make this up" has a mechanical answer rather than an assurance.

There is no dispatch, no verification, and no experiment. The module produces a value.
Nothing sends it anywhere, nothing acts on it, and nothing measures what happened
afterwards.

## The one guarantee: no code

The product decision (recorded in the product decisions doc) is that we dispatch a
spec, not a patch. A fix spec says what is wrong and what the evidence is, and leaves
the fix to the agent reading it. So no output of this module may contain a code fence,
a diff hunk, a patch header, a file path with a line number, or an instruction phrased
as an edit.

That is enforced structurally, not by review, and the argument is this:

1. No sentence is composed in the module. Every sentence is a fixed template, from
   `@growthmind/shared`'s already-audited floor vocabulary or from the two tables the
   module declares itself, with values written into it by the `substitute` seam, which
   refuses any placeholder it cannot resolve.
2. Every template passes a code gate before it is used. `templateOrRefuse` runs
   `isCodeShaped` over the template on every render, not once at module load and not
   in a test only, so a table edit that introduced a backtick, an operator, a
   filename, or an edit instruction throws instead of shipping.
3. The substituted values are drawn from exactly four bounded sources: a surface
   already proved to be in normalised form by the module that owns normalisation,
   integers from a branded `MeasuredCount`, the literal string "sessions", and the
   date part of an ISO instant. None of the four can carry a fence, a hunk header, or
   an imperative.

The stated bound on the guarantee, because an unqualified "the output contains no
code" would be a claim wider than the mechanism supports: a customer's own normalised
`url_path` is rendered verbatim, and `normaliseUrlPath` strips a query and a fragment
but does not police punctuation. A page really named with a backtick in it renders
with that backtick. That is correct behaviour and not a hole (see the composed-input
rule below); what the module guarantees precisely is that no code marker it authored
can reach the output.

## The composed-input rule, applied twice

Both guards in the module scan the template, before substitution, never the rendered
sentence. That is deliberate and it is the whole of the composed-input lesson from the
edge-case taxonomy: a keyword classifier fed a document containing a segment it was
never designed for matches boilerplate in that segment and flips the pipeline's
behaviour.

The concrete case, asserted as intended in the delivery tests:
`describesPeople("/users/profile")` is true, yet `/users/profile` is a customer's own
page address, not a claim about human beings. A guard applied to the rendered sentence
would fire on it, and the only available responses, rewriting the path, dropping the
sentence, or refusing the spec, are all worse than the thing being prevented. So the
customer's data never reaches either guard, and a surface carrying a cohort noun
renders verbatim. There is a named test.

## Fail direction: refuse, everywhere

The Slack delivery module (`packages/core/src/delivery/slack-message.ts`) runs two
guards with different fail directions, chosen by input source: a hit on a
caller-supplied label (our own vocabulary) is refused as a caller bug, while a hit on
model-written prose drops the prose and degrades the message to its numbers-only form,
so a true finding is not withheld over one word.

This module renders no model prose at all. Every string it emits is our own fixed
vocabulary. The degrade branch therefore has no subject here, and the label branch
applies to every string: a violation is a bug in the module's tables or in the
caller's candidate, never a bad draw from a generator. So every gate throws.

Refusing is also the right direction on the merits. A fix spec that never appears is a
gap: a caller notices it and can handle it. A fix spec carrying a patch is the product
doing the single thing it promised not to do, handed to an agent with write access to
somebody's repository.

## Why no event name is rendered

Not rendering event names is a real cost chosen deliberately. A coding agent would
plainly find a name like `checkout_submit_failed` more actionable than "an action
taken there". But an event name is un-normalised, un-redacted external text from a
customer's own instrumentation, and rendering it would either put it through a code
gate designed for our own vocabulary, the exact composed-input mistake above, or past
no gate at all. Naming the event needs a redaction rule for event names, which does
not exist in this repository. Until it does, the spec states the shape of the evidence
and says so out loud in its own boundary sentences.

## Sentence-vocabulary decisions

- Four of the five sentence kinds a fix spec renders already exist, already audited,
  in `packages/shared`'s summary messages: the symptom keyed by finding class, the
  magnitude keyed by count role, the no-rate sentence, and the window. Re-authoring
  them would be a second vocabulary for the same facts, so they are imported, held by
  compile pins: a new finding class, confidence basis, or count role added in core
  without its sentence in shared fails typecheck.
- Evidence sentences are keyed by signal kind so they claim only what one signal is.
  The page is the subject of every one, and no sentence says "people": a signal is one
  observation, and the magnitude that would license a plural human subject lives on
  the predicate that consumed the signal. The gate-messages incident is the record of
  what happens otherwise: a sentence keyed by a state shipped reading "We saw people
  struggling here" on paths where nobody had struggled.
- A finding with no evidence signals renders an explicit no-evidence sentence, not an
  empty section and not a crash. A candidate can legitimately reach the renderer with
  an empty signals array, and a blank section reads as "we did not look", which is a
  different and false claim.
- Three boundary sentences ship on every spec, unconditionally: what was measured is
  one page's behaviour, no source file was read, and the numbers do not settle what to
  do. A reader who has to infer that we did not look at their source may reasonably
  assume we did. No next step is stated: nothing shipped can act on a finding, so a
  sentence implying otherwise would promise work that does not exist.
- The evidence-limit sentence is stated only when there is an evidence section to
  qualify. Each evidence sentence is qualitative by design: a signal's own cohort
  magnitude is a different population from the candidate's counts, and standing the
  two next to each other invites the forbidden reading where one group is handed the
  other's behaviour. Rather than compose that carefully, the spec renders one
  population's magnitudes and says plainly that the evidence lines carry none.
- Coverage sentences travel with the claim: a fix spec that hid a truncated read would
  hand an agent a floor while presenting it as a total. Both are qualitative;
  `eventsWithoutUrlPath` is a bare number with no denominator, legitimately, being a
  statement about the run rather than a claim about the product, and rendering a bare
  number in front of a reader is the one thing `MeasuredCount` exists to prevent.
- Every authored template lives in one derived array so the plain-English audit over
  it is total rather than best-effort; a sentence cannot escape review by being added
  in one place and not the other.

## The code gate's design

The markers are a table of named patterns rather than one fused regular expression, so
a refusal can name the marker it tripped and a test can enumerate the real list
instead of a copy of it.

The list is deliberately broader than prose needs, because of what it is pointed at:
it scans our own vocabulary and nothing else, and our vocabulary is a few dozen
hand-written sentences with no legitimate use for a parenthesis, an angle bracket, an
operator, or a file extension. Strictness against a closed, authored corpus is free;
the same strictness pointed at a customer's data would be the failure. A customer path
like `/docs/readme.md` ends in a file extension and is not a patch, which is exactly
why every caller runs the gate over the template before a value is written in.

No pattern carries the `g` flag. A global regular expression is stateful across
`.test` calls, so the same template would match on one render and not the next: a
determinism bug inside the guard that exists to make the output deterministic.

The brace pair is not banned: `{surface}` is the placeholder syntax the substitution
seam reads, and `substitute` already refuses any placeholder it cannot resolve, so an
unresolved brace never survives to the output.

Miss direction, named: an unmatched phrasing renders. The gate is the cheap mechanical
last catch over a closed corpus a human wrote; it is not the primary control, and it
is not a claim to recognise every possible code shape. The primary control is that no
sentence is composed in the module at all.

## Rendering decisions

- `templateOrRefuse` is the last gate before our vocabulary becomes a sentence, and it
  runs on every render, so a table edited in a later sprint is checked by the code
  that uses it and not by a reviewer's memory. Three refusals: a template that is not
  exactly one sentence (refused rather than split, because splitting would mean
  authoring a sentence boundary, the one thing the module must never do); a template
  that is code-shaped; and a count sentence that describes people. The people check is
  conditional on the template carrying a count, and that is the precise rule rather
  than a softened one: identity stitching does not exist in this product, so "12 of
  25" means sessions, and pairing that with a cohort noun makes a claim about human
  beings nothing measured; but a count-free sentence may name people where a cohort
  magnitude licenses it, and a blanket ban would refuse the shipped, audited symptom
  vocabulary the module reuses. `describesPeople` is imported from the delivery
  module rather than reimplemented: one cohort matcher for the product, so a noun
  added there is caught here for free.
- Refusal messages name the slot and the marker, and no template text. A slot name and
  a marker name are facts about this codebase and are safe in a log line; a rendered
  sentence carries a page path and count values, and neither is a fact about this
  codebase.
- Every surface rendered is proved normalised first, including the one a `struggle` or
  `clean_exit` signal carries of its own: a signal's surface is a different field from
  the candidate's and nothing guarantees the two agree. A raw path can carry a live
  token or an email address, a fix spec is handed to an agent that may log it, and the
  refusal names only the normalised form, never the value that came in.
- No ratio is computed between counts. A funnel finding's two counts share one
  denominator, so dividing one by the other does not produce the drop rate the
  detector applied its threshold to; that rate has a different denominator, no
  `MeasuredCount` carries it, and deriving it here would be the module inventing a
  statistic. The honest consequence: an agent is shown the two counts the threshold
  was computed from, not the threshold's own rate.
- A zero denominator takes the explicit no-rate sentence, never a division, a blank,
  `0%` or `NaN`. On the other branch the rate's value is deliberately never printed:
  the product renders no numeric precision anywhere, the numerator and denominator are
  the claim, and a percentage beside them would be the most memorable thing a reader
  took away precisely because it looks exact.
- No class is re-derived (the gate's conclusion is read as given), no signal magnitude
  is rendered, and no clock is read: both ends of the window arrive on the candidate
  and render as dates, not as a phrase like "the last seven days", which would be
  relative to a moment the code cannot read and would stop being true the day after it
  was written, in a spec an agent may open long after it was made.
- Evidence sentences are deduplicated, and it is not cosmetic: four struggle signals
  on one page produce four identical qualitative sentences, and emitting the same
  sentence four times would state one observation as though it had been made four
  separate ways, the multiplicity failure dressed as prose. The same applies to the
  one measurement dedup: at a zero denominator both count roles produce the identical
  no-rate sentence.
- `sentences` is derived from the four sections, never separately assembled, so a
  section cannot be added to the spec and quietly omitted from the flattening a caller
  and an audit both read.
- The isolation half, that one refused finding must not abort a whole run, is not in
  this module and is not claimed. It belongs to whatever eventually calls it, and
  nothing does yet.
