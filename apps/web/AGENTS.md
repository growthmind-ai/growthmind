# apps/web

The root [AGENTS.md](../../AGENTS.md) is the contract. This file is the part
that applies only inside `apps/web`, and agents read the nearest file in the
tree, so this one wins here.

- **`page.tsx` files stay server components.** Client logic lives in a separate
  `"use client"` component that the page renders. A `"use client"` at the top of
  a page pulls the whole subtree across the boundary, and nothing fails until
  something in it reaches for a server-only import.
- **Mantine v9 is the UI layer**, with its own components and tokens rather than
  raw CSS or a second styling system. `components/` holds the composed
  primitives this app is built from — copy the pattern there before reaching for
  a Mantine component directly, so a change lands in one place rather than
  fifteen.
- **API routes are their own job**, with tenant scope and schema ownership
  decided at the route or not at all. Read
  [.agents/skills/adding-an-api-route](../../.agents/skills/adding-an-api-route/SKILL.md)
  before adding one under `app/api/`.
