# Governance

Growthmind is open source and founder-led. Both halves of that are deliberate,
and this document exists so you find out here rather than in a closed pull
request.

## Who decides

The maintainers, `@growthmind-ai/founders` in
[.github/CODEOWNERS](.github/CODEOWNERS), have the final call on what ships.
There is no committee, no vote, and no technical steering group. The people
who wrote [docs/product-decisions.md](docs/product-decisions.md) are
accountable for whether the product it describes actually works, so they own
the decisions it contains.

That is a benevolent-dictator model. It is not an accident of a young
repository that will be corrected later, and it is not a placeholder for a
foundation. If that is a dealbreaker for you, better to know now.

## What is open to contribution

Nearly all of the actual work:

- **Code**, the app, the SDK, the worker, the analysis pipeline, performance,
  refactors that make a subsystem easier to reason about.
- **Tests**, especially for pure logic. Extractors, scorers, resolvers, and
  diff utilities are where correctness lives.
- **Docs**, anything wrong, unclear, or out of date. Corrections to `docs/`
  are welcome; changing what the decisions _say_ is a different thing (below).
- **Adapters and integrations**. Analytics sources, model providers,
  deployment targets. Product decision §11 leaves the adapter pattern an open
  question on purpose.
- **Self-host paths**, anything that makes `docker compose up` from a clean
  clone work in more places.
- **Bug reports and security reports.** Both are genuinely useful.
  Vulnerabilities go through [SECURITY.md](SECURITY.md), never a public issue.
- **Arguments with our decisions.** See below. This is a first-class
  contribution, not a tolerated one.

## What is not open

[docs/product-decisions.md](docs/product-decisions.md) (§1–§12) is the
contract this codebase is built against, and it is the maintainers' call.
[docs/architecture.md](docs/architecture.md) maps each decision to the
subsystem that enforces it; [docs/stack.md](docs/stack.md) records which
dependencies were rejected and why, so those aren't re-litigated either.

A change to a product decision is a product decision, not a docs edit. We
will change them (several are wrong and we don't know which yet) but the
change happens in the open, as a decision, before any code depends on it.

## How to change our mind

Open an [Argue with a
decision](https://github.com/growthmind-ai/growthmind/issues/new?template=decision-challenge.yml)
issue. There is a template for it because the decisions were published
precisely so they could be attacked.

The order matters: **argue before writing the code, not in the PR that
violates it.** A PR that quietly breaks a published decision gets declined no
matter how good it is, and that is a waste of your afternoon we would rather
prevent than perform.

The strongest form of the argument is a concrete scenario where following the
decision produces a worse product than your alternative. Plus what the
alternative costs. If you convince us, the decision changes first and the code
follows. If you don't, we will say why in the issue and it stays there in
public for the next person.

## What will never be accepted

Anything that violates a published product decision. Concretely, and these are
the ones people try: a ranked list of twelve findings (§7),
requiring a tracking plan or an activation definition up front (§1, §3),
anything that puts PII in the event stream (§5), Growthmind writing code into
a customer's repository (§1, §8), touching pricing, billing, auth, consent or
terms (§5), running an experiment it can calculate is underpowered (§8), a
feature that needs an external SaaS with no self-host path or graceful absence
(§1 and [CONTRIBUTING.md](CONTRIBUTING.md)), and any product taxonomy the
customer has to learn (§10).

None of those are judgements about your code. They are the boundary the
product is built on, and it is written down so it can be checked before you
start.

## Licence and contribution terms

**There is no CLA and no copyright assignment.** You keep the copyright in
what you write. Inbound equals outbound: contributions are licensed under the
[MIT License](LICENSE), the same terms as the project, which is what
[CONTRIBUTING.md](CONTRIBUTING.md) already says. Opening a pull request is the
whole ceremony, no form to sign, no bot to satisfy.

Because it is MIT, a decision you're certain we got wrong is forkable. We'd
rather that than pretend the boundary isn't there.

## Commit access

Today, only the founders have write access, and there is no formal ladder
because there is no track record to judge anyone against yet.

What we would actually look for, honestly stated: a run of merged pull
requests in one area of the codebase, useful review comments on other
people's work, and judgement about the contract. Someone who spots that a
change violates a decision before we do. That earns review rights in that
area first, then commit access. There is no PR count that buys it, and asking
is not presumptuous, open an issue and ask.

If that changes, it changes here.

## Response times

There is no SLA, and we are not going to invent one. This is a pre-release
project with a very small team building the core loop, which means:

- Security reports get looked at first. See [SECURITY.md](SECURITY.md).
- Everything else may wait days, sometimes longer. Quiet stretches happen.
- A bump on a stale issue or PR is welcome, not rude. Bump it.
- If you are planning something large, open an issue before you build it. We
  would much rather tell you early that it conflicts with a decision than read
  a week of your work and decline it.

Under-promising is the point. When response times get better we will say so
here rather than promise it in advance.
