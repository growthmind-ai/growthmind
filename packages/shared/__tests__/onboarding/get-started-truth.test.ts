// THE PUBLIC-DOCS TRUTH GUARD — AD-21. ADD §9, 2 rows.
//
// ###########################################################################
// # WHY A TEST SUITE READS A MARKDOWN FILE.
// #
// # `docs/` is PUBLIC SHIPPED DOCUMENTATION. `AGENTS.md` is explicit that a
// # PR violating a product decision is declined regardless of code quality —
// # and shipping a surface whose own public product page contradicts it, in
// # the same release, IS that violation.
// #
// # `docs/get-started.md` today promises two things this sprint deliberately
// # stops promising:
// #
// #   1. A DURATION. "the finding push is bound by the 5-20 s budget" (:27),
// #      restated at :172 and :191. Ruling R1b is that we MEASURE and never
// #      PROMISE: PostHog's own ~24 s p90 leg is accepted and outside our
// #      control, so a committed push window is a promise the product cannot
// #      keep and now refuses to make. Every rendered string on the new
// #      surface is scanned for exactly this (`messages.test.ts` row 2, AD-3's
// #      counter narrowing, B1/B2) — and it would all be for nothing if the
// #      page a founder reads BEFORE signing up still carried the number.
// #
// #   2. "masking verified" (:56, :62) as step two's confirmation. Ruling R2:
// #      there is nothing to verify. `packages/sdk-js` is a 19-line stub whose
// #      own comment says "Nothing is implemented yet", and no masking config
// #      exists anywhere in the schema. It is replaced by the read-only
// #      privacy posture receipt, which proves what IS shipped.
// #
// # `docs/mvp.md` was already amended on this branch (commit 3e5f757, §7
// # deviation 4). `get-started.md` is the remaining contradiction, and these
// # two rows are what make correcting it a gate rather than a good intention.
// ###########################################################################
//
// WAVE 8 MAKES THESE GREEN. They are red on this tree ON PURPOSE, and they are
// red for the right reason: the file genuinely still says both things.
//
// DELIBERATELY NARROW so they are not brittle. Two literal strings, no
// sentence structure, no line numbers — the page can be rewritten however its
// author likes, as long as it stops saying these two things.
//
// SCOPE: `docs/mvp.md` and the outcomes file are NOT touched by this sprint
// (the coordinator is amending them; an edit here would collide), and neither
// is asserted on here.

import { describe, expect, test } from "bun:test";

/** Read with `Bun.file`, not a node builtin — the convention every
 *  source-reading suite in this repo already follows. */
const GET_STARTED_PATH = `${import.meta.dir}/../../../../docs/get-started.md`;

const readGetStarted = async (): Promise<string> => {
  const file = Bun.file(GET_STARTED_PATH);

  if (!(await file.exists())) {
    throw new Error(
      `docs/get-started.md was not found at ${GET_STARTED_PATH}. This suite guards a PUBLIC ` +
        `page against contradicting the product in the same release; if the page moved, this ` +
        `guard has to move with it rather than be deleted.`,
    );
  }

  return file.text();
};

/**
 * The offending LINES, not the whole page.
 *
 * A bare `expect(page).not.toContain(...)` prints ten kilobytes of markdown on
 * failure, and the one line that matters is somewhere inside it. Whoever picks
 * this up in Wave 8 should see the three lines they have to edit and nothing
 * else.
 */
const offendingLines = (page: string, needles: readonly string[]): string[] =>
  page
    .split("\n")
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => needles.some((needle) => line.includes(needle)))
    .map(({ line, number }) => `${number}: ${line}`);

describe("docs/get-started.md — AD-21", () => {
  // ---------------------------------------------------------------- §9 row 1
  test("the public get-started page commits to no glue-moment duration", async () => {
    const page = await readGetStarted();

    // THREE ENCODINGS OF ONE PROMISE, and that is why this is one row rather
    // than three:
    //   - "5–20", the en-dash form the file writes today (:27, :172, :191);
    //   - "5-20", so the fix cannot be "swap the dash" — a page reading
    //     "5-20 s budget" says exactly what "5–20 s budget" said;
    //   - "five-to-twenty-second", the SPELLED-OUT form in the opening
    //     blockquote (:8). The ADD names only the first, and a correction that
    //     removed the two numerals while leaving "the five-to-twenty-second
    //     push is the budget the build is held to" in the first paragraph
    //     would leave the promise fully intact and the guard fully green.
    //     That is the D9 failure mode — one claim, several spellings, a check
    //     pinned to one of them.
    const promises = offendingLines(page, ["5–20", "5-20", "five-to-twenty-second"]);

    expect(promises).toEqual([]);
  });

  // ---------------------------------------------------------------- §9 row 2
  test("the public get-started page no longer promises masking verified", async () => {
    const page = await readGetStarted();

    // Appears twice today: once inside the terminal transcript (:56) and once
    // in the paragraph that explains it (:62). Both go — the transcript line
    // is the one a reader believes, and the paragraph is the one that argues
    // for it.
    const claims = offendingLines(page, ["masking verified"]);

    expect(claims).toEqual([]);
  });
});
