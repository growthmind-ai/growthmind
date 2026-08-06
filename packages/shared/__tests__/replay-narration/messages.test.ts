import { describe, expect, test } from "bun:test";

import * as recordingNarration from "../../src/replay-narration/messages";
import {
  ALL_RECORDING_NARRATION_MESSAGES,
  RECORDING_SUMMARY_HELD,
  RECORDING_SUMMARY_PENDING,
} from "../../src/replay-narration/messages";
import { assertUnderConstruction } from "../onboarding/module-under-construction";

const OWNER =
  "ADD O-047 AD-8 (packages/shared/src/replay-narration/messages.ts — the five new recording state sentences)";

const NEW_CONSTANT_NAMES = [
  "RECORDING_SUMMARY_NO_SOURCE",
  "RECORDING_SUMMARY_NO_SOURCE_LINK",
  "RECORDING_SUMMARY_NOT_CONFIGURED",
  "RECORDING_SUMMARY_READ_FAILED",
  "RECORDING_SUMMARY_PARTIAL",
] as const;

type NewConstantName = (typeof NEW_CONSTANT_NAMES)[number];

const REFUSAL_CODES = /no_connection|unreadable_credential|not_configured|pullReason|pullStop/;

function sentence(exportName: NewConstantName): string {
  const value = (recordingNarration as unknown as Record<string, unknown>)[exportName];

  assertUnderConstruction(typeof value === "string" && value.length > 0, {
    contract: `\`${exportName}\` is exported from packages/shared/src/replay-narration/messages.ts`,
    ownedBy: OWNER,
  });

  return value as string;
}

// AD-8's state table: one sentence per state the card renders. The AnchorLink label
// RECORDING_SUMMARY_NO_SOURCE_LINK is a control, not a state, so it is not one of the six.
function cardSentences(): readonly string[] {
  return [
    sentence("RECORDING_SUMMARY_READ_FAILED"),
    sentence("RECORDING_SUMMARY_NO_SOURCE"),
    sentence("RECORDING_SUMMARY_NOT_CONFIGURED"),
    sentence("RECORDING_SUMMARY_PARTIAL"),
    RECORDING_SUMMARY_PENDING,
    RECORDING_SUMMARY_HELD,
  ];
}

describe("the recording narration registry", () => {
  test("should register every new recording sentence", () => {
    const registered = new Set(ALL_RECORDING_NARRATION_MESSAGES);
    const missing = NEW_CONSTANT_NAMES.filter((name) => !registered.has(sentence(name)));

    expect(missing).toEqual([]);
  });
});

describe("the six sentences the recording summary card can render", () => {
  test("should keep the six card sentences pairwise distinct", () => {
    const six = cardSentences();

    expect(six).toHaveLength(6);
    expect(new Set(six).size).toBe(6);

    // A read that failed currently borrows the pending sentence, so a founder reads a
    // dead end as patience. Pinning this pair is the whole outcome.
    expect(sentence("RECORDING_SUMMARY_READ_FAILED")).not.toBe(RECORDING_SUMMARY_PENDING);
  });

  test("should keep every card sentence free of refusal codes and ids", () => {
    expect("the source answered not_configured").toMatch(REFUSAL_CODES);

    expect(cardSentences().filter((message) => REFUSAL_CODES.test(message))).toEqual([]);
  });
});
