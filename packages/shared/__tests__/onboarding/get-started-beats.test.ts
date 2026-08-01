// AD-21's THIRD EDIT, PINNED. Wave 0g, ADOPTED ORPHAN. 1 row.
//
// ###########################################################################
// # WHY THIS ROW EXISTS WHEN THE ADD DID NOT ASK FOR IT.
// #
// # AD-21 names THREE edits to `docs/get-started.md` and then says: "Two
// # literal assertions guard them: the file contains neither `5–20` nor
// # `masking verified`." Count the edits against the guards:
// #
// #   edit 1 — §2's beat table loses its committed timecodes and the
// #            "Twelve seconds" beat.                          ← NO GUARD
// #   edit 2 — §3's `masking verified` becomes the receipt.     ← guarded
// #   edit 3 — §6's 5-20 s budget becomes the measured bar.     ← guarded
// #
// # Wave 0c wrote the two guarded rows in `get-started-truth.test.ts` and
// # flagged the gap. This is it, closed. **It is a 210th row, named as an
// # addition to the ADD's 208 rather than smuggled into the count.**
// #
// # The failure it prevents is specific and has happened here before: ADD §10
// # records that "a prior sprint marked four rows done from intent alone". A
// # Wave 8 agent told to make three edits, with two of them gated and one not,
// # makes two edits. Nothing fails. The public page keeps a table of committed
// # timecodes on the same release as a product surface whose binding rule B2 is
// # that NO string commits to a duration, and `AGENTS.md` declines PRs for
// # exactly that.
// ###########################################################################
//
// WHY IT IS A SECOND FILE AND NOT A THIRD ROW IN THE SIBLING. Wave 0c owns
// `get-started-truth.test.ts`, and this sprint's ownership map is the safety
// mechanism against the parallel-agent git collisions three retros in a row
// report (AD-23). Editing another wave's committed file to add a row is exactly
// the move that caused them. **WHEN THE OWNERSHIP FENCE COMES DOWN AFTER WAVE
// 0, THESE THREE ROWS SHOULD BE ONE FILE** — two suites guarding one page is a
// second home, and second homes drift.
//
// ---------------------------------------------------------------------------
// AN OBSERVATION THIS FILE DELIBERATELY DOES NOT ASSERT, RECORDED SO IT IS NOT
// LOST — FOR THE PM AND FOR WAVE 8.
//
// `docs/get-started.md:15` is the page's headline contract: **"Break your
// product. Count to twelve."** — restated at `:171` ("the film shows twelve
// …"). By the same reasoning R1b used to strike "5-20 s", that is a committed
// duration in the loudest position on a public page. It is NOT one of AD-21's
// three named edits, and this suite does not assert it away: expanding a
// product-copy decision by writing a test is the wrong direction, and the
// number may well be a deliberate hook rather than a promise. **It needs a
// decision, not a guard.** If the answer is that it goes, it belongs in row 1
// of `get-started-truth.test.ts` beside the other duration encodings.
// ---------------------------------------------------------------------------
//
// WAVE 8 MAKES THIS GREEN. It is red on this tree ON PURPOSE and for the right
// reason: the beat table genuinely still carries ten timecodes and the beat.
//
// DELIBERATELY NARROW, matching its sibling's discipline: the table's own
// column header and one bolded literal. The page can be rewritten however its
// author likes — the beats can stay, the intervals can stay, the whole section
// can be reordered — as long as it stops committing to a clock.

import { describe, expect, test } from "bun:test";

/** Read with `Bun.file`, matching `get-started-truth.test.ts` exactly. */
const GET_STARTED_PATH = `${import.meta.dir}/../../../../docs/get-started.md`;

const readGetStarted = async (): Promise<string> => {
  const file = Bun.file(GET_STARTED_PATH);

  if (!(await file.exists())) {
    throw new Error(
      `docs/get-started.md was not found at ${GET_STARTED_PATH}. This suite guards a PUBLIC page ` +
        `against contradicting the product in the same release; if the page moved, this guard has ` +
        `to move with it rather than be deleted.`,
    );
  }

  return file.text();
};

/** The offending LINES, not the whole page — the sibling's helper, same reason:
 *  whoever picks this up in Wave 8 should see the lines they have to edit and
 *  nothing else, rather than ten kilobytes of markdown. */
const offendingLines = (page: string, matches: (line: string) => boolean): string[] =>
  page
    .split("\n")
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => matches(line))
    .map(({ line, number }) => `${number}: ${line}`);

/**
 * A row of the beat table carrying a timecode.
 *
 * SCOPED TO THE TABLE, not to the page, and that scoping is the whole reason
 * this row is not brittle. `mm:ss` stamps appear elsewhere in the file
 * legitimately — inside the illustrative Slack message ("3 of 3 save attempts
 * since 04:55 failed") and the suppression line ("05:58 · same signature").
 * Those are a rendered FINDING's own content, which really does carry wall
 * clock times; they are not the product promising how long anything will take.
 * A page-wide `\d\d:\d\d` ban would delete the example that makes the page
 * worth reading, in service of a rule it does not break.
 */
const TABLE_ROW = /^\|/;
const TIMECODE = /\|\s*\d{1,2}:\d{2}\s*\|/;

/** §2's table header, which is where the `tc` column announces itself. */
const TC_COLUMN_HEADER = /^\|\s*Beat\s*\|\s*tc\b/i;

/** The beat itself — the one AD-21 names by name. */
const TWELVE_SECONDS = /Twelve seconds/i;

describe("docs/get-started.md — AD-21 edit 1, the beat table", () => {
  test("the public get-started page's beat table commits to no timecode", async () => {
    const page = await readGetStarted();

    // NON-VACUITY FIRST. The scanners have to bite on the page as it stands, or
    // a green here after some future rewrite would mean "the table moved" as
    // readily as "the table was fixed". These three assertions describe TODAY
    // and are expected to be the thing that changes.
    const beatRows = offendingLines(page, (line) => TABLE_ROW.test(line) && TIMECODE.test(line));
    const header = offendingLines(page, (line) => TC_COLUMN_HEADER.test(line));
    const beat = offendingLines(page, (line) => TWELVE_SECONDS.test(line));

    // The `tc` COLUMN goes, because a column is a commitment the table keeps
    // making for every row somebody adds later. AD-21: "The table describes the
    // sequence of events; it commits to no duration."
    expect(header).toEqual([]);

    // Every timecoded row goes with it. `05:07` next to "What happened, to
    // whom, with proof" is the 5-20 s promise in another notation — and R1b's
    // reasoning is that PostHog's own ~24 s p90 leg is outside our control, so
    // a committed number is a promise the product cannot keep.
    expect(beatRows).toEqual([]);

    // And the beat AD-21 names outright. It is the loudest line in the table
    // and the one a reader remembers, which is exactly why it is named.
    expect(beat).toEqual([]);
  });
});
