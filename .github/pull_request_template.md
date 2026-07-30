<!--
Thanks for contributing. Two documents outrank code quality here:
docs/product-decisions.md (the product contract) and docs/architecture.md
(which subsystem enforces what). A PR that violates a product decision will
be declined regardless of how good the code is. GOVERNANCE.md explains who
decides, and how to argue a decision down before you write the code.
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
unit tests — point at them. If there is deliberately no test, say why. -->

## Checklist

- [ ] `bun run check` passes locally (typecheck + lint + format + test + build)
- [ ] No product decision in docs/product-decisions.md is violated
- [ ] Customer-facing strings are plain English; counts carry denominators
- [ ] New dependencies had their LICENSE read (docs/stack.md, standing rules)
