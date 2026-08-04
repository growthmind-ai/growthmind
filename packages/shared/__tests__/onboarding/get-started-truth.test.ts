import { describe, expect, test } from "bun:test";

import { AGENT_PROVIDER_CONFIGS } from "../../src/onboarding/agent-blocks";
import { AGENT_RUN_ANYWHERE_LINE } from "../../src/onboarding/messages";

const GET_STARTED_PATH = `${import.meta.dir}/../../../../docs/get-started.md`;

const USER_SCOPE_FLAG = "--scope user";

const BLOCK_INPUT = { url: "https://app.example.com/api/mcp", key: "gmak_get-started-fixture" };

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

describe("the command the panel hands out, and the claim beside it — O-026", () => {
  test("every command block carries the flag the page says keeps the entry out of this project", async () => {
    const page = await readGetStarted();

    expect(page).toContain(USER_SCOPE_FLAG);
    expect(page).toContain("instead of this project's");

    const commands = AGENT_PROVIDER_CONFIGS.filter((config) => config.format === "command");
    expect(commands.map((config) => config.id)).toEqual(["claude-code"]);

    const unscoped = commands
      .filter((config) => !config.render(BLOCK_INPUT).includes(USER_SCOPE_FLAG))
      .map((config) => config.id);

    expect(unscoped).toEqual([]);
  });

  test("the line beside that command claims anywhere, and says which config it lands in", () => {
    expect(AGENT_RUN_ANYWHERE_LINE).toContain("anywhere on your machine");
    expect(AGENT_RUN_ANYWHERE_LINE).toContain("your own config rather than this project's");
  });
});
