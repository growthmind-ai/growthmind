import { describe, expect, test } from "bun:test";

import {
  ALL_ONBOARDING_MESSAGES,
  LIVE_STEP_DESCRIPTORS,
  STEP_DESCRIPTORS,
} from "@growthmind/shared";

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const COUNT_BEFORE_STEP = new RegExp(
  `\\b(\\d+|${Object.keys(NUMBER_WORDS).join("|")})\\s+steps?\\b`,
  "gi",
);

function statedStepCounts(message: string): readonly number[] {
  const counts: number[] = [];

  for (const match of message.matchAll(COUNT_BEFORE_STEP)) {
    const token = (match[1] ?? "").toLowerCase();
    const value = NUMBER_WORDS[token] ?? Number.parseInt(token, 10);

    if (Number.isFinite(value)) counts.push(value);
  }

  return counts;
}

function messagesMiscountingSteps(
  messages: readonly string[],
  renderedRows: number,
): readonly string[] {
  return messages.filter((message) =>
    statedStepCounts(message).some((stated) => stated !== renderedRows),
  );
}

const LIVE_ROWS = LIVE_STEP_DESCRIPTORS.length;

const FILLED_STUB_KINDS: readonly string[] = STEP_DESCRIPTORS.map((descriptor): string =>
  descriptor.kind === "coming-next" ? "work" : descriptor.kind,
);

const FILLED_STUB_ROWS = FILLED_STUB_KINDS.filter((kind) => kind !== "coming-next").length;

const PLANTED_MISCOUNT = "Setup done — show the seven steps";

describe("a label may not claim a step count the panel beneath it does not render", () => {
  test("no onboarding label states a step count that differs from the rows rendered beside it", () => {
    expect(messagesMiscountingSteps([PLANTED_MISCOUNT], LIVE_ROWS)).toEqual([PLANTED_MISCOUNT]);
    expect(
      messagesMiscountingSteps([`Setup done — show the ${LIVE_ROWS} steps`], LIVE_ROWS),
    ).toEqual([]);

    expect(messagesMiscountingSteps(ALL_ONBOARDING_MESSAGES, LIVE_ROWS)).toEqual([]);
  });

  test("the invariant still holds when both stubs are filled", () => {
    expect(FILLED_STUB_ROWS).toBe(5);
    expect(FILLED_STUB_ROWS).not.toBe(LIVE_ROWS);

    expect(messagesMiscountingSteps(ALL_ONBOARDING_MESSAGES, FILLED_STUB_ROWS)).toEqual([]);
  });
});
