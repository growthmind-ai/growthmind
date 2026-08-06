# Contributing

Growthmind is MIT-licensed and built in the open. Contributions are welcome —
code, tests, docs, and arguments with our decisions all count.

## The one rule that outranks code quality

This codebase is built against the commitments in [AGENTS.md](AGENTS.md),
under "The commitments a PR is judged against". **A PR that breaks one will be
declined regardless of how good the code is.** Read them first. They are short,
and they are the contract. [docs/architecture.md](docs/architecture.md) maps
each commitment to the subsystem that enforces it, and
[docs/stack.md](docs/stack.md) explains why each dependency was chosen (and
which were rejected, so we don't re-litigate).

If you think a decision is wrong, open an issue and argue with it, that is
exactly what publishing them is for. Just do it before writing the code, not
in the PR that violates it.

This project is founder-led, and [GOVERNANCE.md](GOVERNANCE.md) says plainly
who decides, what is open to contribution and what isn't, and how commit
access could be earned. Worth two minutes before a large PR.

## Reading the comments

This codebase is commented more heavily than most, and the comments are about
_why_. They mark which decision a piece of code is discharging, so you can tell
a deliberately awkward shape from an accident before you "simplify" it. If a
comment ever states a rule the code does not follow, that is a bug worth an
issue.

[docs/reliability-checklist.md](docs/reliability-checklist.md) is the list of
failure modes those comments most often guard against, and it is worth skimming
once before your first change.

When you add a comment, match the discipline rather than the length: say what
the next reader could not work out from the code. Keep it in plain prose, skip
the section banners and the capital letters, and put long-form design rationale
in `docs/` where it can be reviewed as documentation.

## Getting started

```bash
git clone https://github.com/growthmind-ai/growthmind.git
cd growthmind
docker compose up          # full stack: Postgres + web + worker
```

For day-to-day development:

```bash
bun install                # bun 1.3+ (https://bun.sh)
docker compose up postgres # just the database
bun run dev                # Next.js app on :3000
bun run dev:worker         # Graphile Worker, in a second terminal
```

No.env file is needed locally. Development defaults cover everything, and
`.env.example` documents every variable when you want to override one.

## Before you open a PR

```bash
bun run check   # typecheck + lint + format + tests + production build
```

CI runs the same gate plus a `docker compose up` boot from a clean clone, so
a PR that passes locally passes there. Two things CI will not forgive:

- **Self-host is first-class.** Every feature works under `docker compose up`
  with no external SaaS dependency, or ships with a graceful absence path.
  If your PR adds a dependency, answer the compose question in the PR body:
  does a stranger still get a working app in one command?
- **Pure functions get unit tests.** Extractors, scorers, resolvers, diff
  utilities, no shipping without tests for pure logic. Tests live in
  `__tests__/` directories and run with `bun test`.

Licence check for new dependencies: read the LICENSE file of anything
infra-layer in the PR that adds it (docs/stack.md explains why, the
MIT-to-BSL relicensing wave is real).

## AI-assisted contributions

Use whatever tools you like, including coding agents. This repo is built with
them, it ships a machine surface for them, and pretending otherwise would be
strange. Four conditions, and they are about the pull request rather than the
tooling:

- **Disclose it.** One line in the PR body, which tool, and roughly how much of
  the diff. Not a confession; it tells a reviewer where to look hardest, and it
  saves them guessing.
- **You are responsible for all of it.** Every line, including the lines you did
  not write and the ones you did not read. "The agent did that" is not a defence
  in review, and it will not be treated as one.
- **You have run it.** `bun run check` passes, and you have actually driven the
  change, not concluded it works because the types check.
  [.agents/skills/verify-a-change](.agents/skills/verify-a-change/SKILL.md) is
  the procedure, and it exists because passing tests here have coexisted with a
  worker that crashed on boot.
- **You understand it well enough to defend it in review.** If you cannot say
  why a piece of the diff is shaped the way it is, it is not ready.

Unreviewed agent output, a PR whose description does not match its diff, tests
that assert nothing, a "fix" for a problem nobody reported, invented API
surface, a rewrite of a file the issue never mentioned. Gets closed without a
line-by-line review. That is not a judgement about AI; it is that reviewing
those costs more than writing the change, and there is no version of this
project where maintainer attention is the cheap resource. Repeatedly opening
them will get you blocked, and we would much rather say that here than surprise
you with it.

Before a large agent-driven change, open an issue first. Same reason as any
large change: finding out in advance that it conflicts with a decision beats
reading a week of anyone's work (yours or a model's) and declining it.

Two files exist to make all of this easier, and pointing your agent at them
costs nothing: [AGENTS.md](AGENTS.md) (the whole contributor guide, in the
filename agents look for) and [REVIEW.md](REVIEW.md) (what gets a PR sent back
here, distilled from real history).

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org): a `type(scope):`
prefix and a subject in the imperative mood, under about 72 characters.

```
feat(sdk-js): mask input values at capture
fix(worker): backfill missed rollups on restart
docs: explain the finding signature ledger
```

Types in use: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`,
`build`, `ci`, `chore`. Where a change has a reason that isn't obvious from
the diff, put it in the body. The log is the only record of _why_.

## Conventions worth knowing

- **bun everywhere**, package manager, test runner, script runner. Never
  yarn or pnpm here.
- **Zod schemas in `packages/shared` are the single source of truth for
  shapes.** Don't duplicate a shape the schema already owns.
- **`page.tsx` files stay server components**; client logic lives in
  separate `"use client"` components.
- **Plain English in customer-facing strings**. No product jargon, and
  counts always carry denominators ([AGENTS.md](AGENTS.md)).
- **Events discipline mirrors the product's own rules**, deterministic IDs,
  no PII in streams, internal traffic excluded.

## Security issues

Never open a public issue for a vulnerability, see [SECURITY.md](SECURITY.md).

## Licence

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE), the same terms as the project.
