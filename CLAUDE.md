@AGENTS.md

<!--
Claude Code reads CLAUDE.md, not AGENTS.md. The bare `@AGENTS.md` on the first line is an import: Claude Code expands the guide into context at session start, so there is one contract and no second copy to drift from.

A symlink (`ln -s AGENTS.md CLAUDE.md`) would also work, but it needs Administrator or Developer Mode on Windows and cannot carry the section below.

This comment is a block-level HTML comment, which Claude Code strips before loading the file, so it costs no context.
-->

## Claude Code

- `.agents/skills/*/SKILL.md` are read on demand, not loaded automatically. Open the matching one with Read before starting that kind of job — the table in `.agents/README.md` says which job each covers.
- Long-form rationale belongs in `docs/`, not in a comment and not in this file. See the Comments section of the guide above.
- `.claude/` is gitignored and belongs to whoever cloned the repo. Nothing in it is part of the contract, and nothing written there should be committed.
