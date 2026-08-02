import { describe, expect, test } from "bun:test";

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

const offendingLines = (page: string, needles: readonly string[]): string[] =>
  page
    .split("\n")
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => needles.some((needle) => line.includes(needle)))
    .map(({ line, number }) => `${number}: ${line}`);

describe("docs/get-started.md — AD-21", () => {
  test("the public get-started page commits to no glue-moment duration", async () => {
    const page = await readGetStarted();

    const promises = offendingLines(page, ["5–20", "5-20", "five-to-twenty-second"]);

    expect(promises).toEqual([]);
  });

  test("the public get-started page no longer promises masking verified", async () => {
    const page = await readGetStarted();

    const claims = offendingLines(page, ["masking verified"]);

    expect(claims).toEqual([]);
  });
});
