<!--
Thanks for contributing. Two documents outrank code quality here: AGENTS.md
("The commitments a PR is judged against") and docs/architecture.md (which
subsystem enforces what). A PR that breaks a commitment will be declined
regardless of how good the code is. GOVERNANCE.md explains who decides, and
how to argue a commitment down before you write the code.
-->

## What & why

<!-- What changes, and the reason. Link the issue if one exists. -->

## The compose question

<!-- Required if this PR adds or changes a dependency or service, otherwise
delete this section. -->

Does a stranger still get a working app from a clean clone with
`docker compose up`, no signup, no API key? If a cloud service is involved,
what is the self-host path or graceful absence?

## Tests

<!-- Pure logic (extractors, scorers, resolvers, diff utilities) ships with
unit tests, point at them. If there is deliberately no test, say why. -->

## How this was built

<!-- If a coding agent wrote part of this, say which and roughly how much
(CONTRIBUTING.md, AI-assisted contributions). It tells a reviewer where to look
hardest. You are responsible for the whole diff either way. Delete this section
if you wrote it all by hand. -->

## Checklist

- [ ] `bun run check` passes locally (typecheck + lint + format + test + build)
- [ ] I ran the change, not just the tests (.agents/skills/verify-a-change)
- [ ] No commitment in AGENTS.md is broken
- [ ] Customer-facing strings are plain English; counts carry denominators
- [ ] New dependencies had their LICENSE read (docs/stack.md, standing rules)
- [ ] Edge cases swept for the surfaces this touches (.agents/skills/edge-sweep);
      anything handled-but-untested is named above
