# Reliability checklist

The ways a multi-tenant event pipeline actually breaks in production, kept as a
living list. It is not a style guide and not a test plan. It is the set of
questions worth answering before you call a change done.

Most entries are a variation on one theme: **the code works for the person who
set it up, in the happy state, on the first try**, and fails quietly for
everyone and everything else.

You do not need to walk all twelve. Find the surfaces your change touches in the
table, then read those.

| If the change touches                                    | Read    |
| -------------------------------------------------------- | ------- |
| An org-scoped resource, or anything that notifies        | 1, 2, 3 |
| A database read or write, a repository, a service method | 2, 6, 7 |
| A webhook, a worker task, an external sync               | 4, 3, 8 |
| An API route, a query param, a DTO                       | 5, 7, 9 |
| A model or agent surface                                 | 5, 8    |
| A gate that decides what the system is allowed to do     | 10, 5   |
| A dedup key, a signature, an upsert conflict target      | 12, 9   |

---

## 1. Audience

Any org-scoped resource or effect has an implicit audience, and the common bug
is narrowing it to whoever triggered the action. A finding, a disconnect, an
experiment verdict published only to the acting user leaves their teammates
watching data change with no signal.

For each effect, say out loud who receives it: the actor, the whole
organisation, a Slack channel, nobody. If it is deliberately owner-only, write
that down as a decision rather than leaving it to be inferred. Check what
happens when the resource has no owner at all.

**Test:** seed one organisation with two members, run the effect as the first,
and assert what the second sees.

## 2. Scope

Anything ownable at either user or organisation level has to be read, written,
listed, deleted, and _addressed_ at the same level by every caller. An
org-scoped row fetched with `where user_id = actor` is invisible to the rest of
the organisation.

The subtler half is stamp and filter symmetry: if a read filters on a column,
the write path must set it. A filter on a column nothing populates matches zero
rows, which reads as "no data yet" rather than as a bug.

**Test:** a teammate who did not create the resource can still read and act on
it. A fixture that omits the narrowing column still comes back from the query.

## 3. Multiplicity

Zero, one, many. If an organisation has two matching rows, does the effect fire
once or twice, and which did you intend? If it has none, does the code degrade
quietly or silently no-op in a way that reads as success?

Watch for two code paths producing the same logical effect in one operation.
That is how the same finding gets posted to Slack twice.

**Test:** seed two matching rows, assert exactly one downstream effect.

## 4. Delivery

Anything crossing a process boundary runs twice, out of order, or never.

- The same webhook delivered twice must leave the same end state.
- A worker task replayed after a partial failure must not repeat the steps that
  already succeeded.
- Any UI gated on a live signal alone sticks for whoever loads the page after
  the event. Reconcile against persisted state instead.
- A completion can arrive before the record it completes has committed.

**Test:** invoke the handler twice with one payload, assert one write and one
send. Mount the UI with no live signal and completed state, assert it renders
as done.

## 5. Data shape

Null, empty, one element, zero denominator, and every shape ever written.

The declared schema describes what you write today, not what is already stored.
Jsonb columns in particular hold every historical payload. Coerce at the
boundary rather than trusting the type. Model output is external input too:
validate it before persisting, never assume it matches the schema you asked for.

**Test:** the pure function against null, empty, single and boundary inputs, and
a DTO test against a legacy-shaped row.

## 6. Concurrency

Any row written by more than one path invites a lost update. A read followed by
a write usually wants to be one statement: an atomic update, an increment, or an
insert with a conflict target behind a unique index.

Job locking covers the job, not the rows the job then mutates.

**Test:** two concurrent updates against the fake repository, assert neither is
lost.

## 7. Tenant boundary

The enforced path is request, then tenant context, then service, then
repository. The risk is never the base methods. It is the paths that step
outside them.

- A system context exists for worker jobs. Is it reachable from anything a user
  can trigger?
- A hand-written query or aggregation has to scope itself. Auto-injection does
  not reach it.
- Key-authenticated calls need the same context enforcement as session ones.
- For any client-supplied id, read the query and prove cross-organisation access
  is impossible.

**Test:** an actor in one organisation attempts to read and to modify a row in
another, and gets nothing rather than silent success.

## 8. Failure isolation

A non-critical side effect must not take down the operation it follows. The
database write is returned to the caller even if the Slack post fails. Delivery
failures get logged and retried, never propagated.

Every path that sets a "running" state needs a terminal state on every exit,
including the ones that throw. A missing terminal state is a job the user
watches forever.

Cleanup counts as a side effect. Make sure it can never delete what the main
flow just produced.

**Test:** make the sender throw, assert the main operation still succeeds and
the failure is logged.

## 9. Names crossing boundaries

A string that has to match something elsewhere will eventually not match it, and
the failure is usually silent rather than loud.

Worker task names are matched by string: a job queued under an unregistered name
retries forever. Event names that drift from the analytics contract count
nothing and raise no error. Query params have to match the server's allow-list.

Use exported constants and let the compiler check the match.

**Test:** a route rejects an unknown param with a 4xx rather than a 500. A new
worker task appears in the registry test.

## 10. Which way a gate fails

Any deterministic gate, a keyword rule, a bot filter, a severity threshold, is a
classifier, and classifiers miss. Unusual phrasing, another language, negation,
typos. The question is not whether it misses but what happens when it does.

A gate that decides what the system is _allowed_ to do should fail open to the
full default path. An exclusion filter has to decide explicitly whether a miss
over-counts or under-counts, and which of those is acceptable. Watch for
exclusion rules that fire on a superset of their target: a bot filter broad
enough to drop real sessions erases the evidence behind a finding.

Check that a classifier still sees only the text it was designed for after
something upstream starts appending to its input.

**Test:** a fixture the rules do not match still takes the safe path. Each
exclusion rule has a near-miss fixture proving it does not fire.

## 11. Producer and consumer

When one surface computes a value and a different surface consumes it, nothing
proves the wire between them is connected. The consumer reads a field that is
always absent, its "when present" branch never runs, and every null check
downstream treats the permanent absence as the legitimate no-signal case. Both
sides have passing tests.

Grep the consumer for the field name and confirm something actually writes it on
the path that reaches it. Where possible, have the consumer derive the value
itself: one home, no wire to sever.

**Test:** call the consumer's real entry point without the producer having run,
and assert the effect still happens or is explicitly absent.

## 12. Identity that churns

Any dedup key, signature, or "have we seen this" lookup is exactly as stable as
its least stable input. When a derived input changes for a legitimate reason, a
rename, a re-derivation, a new normaliser version, the identity forks. The same
logical thing re-enters the system as new, every guarantee hanging off the key
fails open, and nothing errors.

For each input to the key, name what can change it and what keeps it stable
across that change. Where it cannot be kept stable, record the old-to-new
mapping and apply it. Version any serialisation that feeds the key.

**Test:** compute the key, apply the realistic rename or re-derivation to the
fixture, recompute, and assert the identity survived. Computing the same input
twice proves nothing here.

---

## The one-line version

Who else hits this, at what scope, with how many matching rows, delivered how
many times, in what shape, and does a failing side effect still let the main
flow succeed?

If any part of that is "I did not check", it is not done yet.
