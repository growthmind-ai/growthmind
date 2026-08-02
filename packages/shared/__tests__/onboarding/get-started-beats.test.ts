import { describe, expect, test } from "bun:test";

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

const offendingLines = (page: string, matches: (line: string) => boolean): string[] =>
  page
    .split("\n")
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => matches(line))
    .map(({ line, number }) => `${number}: ${line}`);

const TABLE_ROW = /^\|/;
const TIMECODE = /\|\s*\d{1,2}:\d{2}\s*\|/;

const TC_COLUMN_HEADER = /^\|\s*Beat\s*\|\s*tc\b/i;

const TWELVE_SECONDS = /Twelve seconds/i;

describe("docs/get-started.md — AD-21 edit 1, the beat table", () => {
  test("the public get-started page's beat table commits to no timecode", async () => {
    const page = await readGetStarted();

    const beatRows = offendingLines(page, (line) => TABLE_ROW.test(line) && TIMECODE.test(line));
    const header = offendingLines(page, (line) => TC_COLUMN_HEADER.test(line));
    const beat = offendingLines(page, (line) => TWELVE_SECONDS.test(line));

    expect(header).toEqual([]);

    expect(beatRows).toEqual([]);

    expect(beat).toEqual([]);
  });
});
