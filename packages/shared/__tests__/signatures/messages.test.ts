import { describe, expect, test } from "bun:test";

import {
  ALL_SUPPRESSION_REASON_MESSAGES,
  FORBIDDEN_PRODUCT_JARGON,
  SUPPRESSION_REASON_MESSAGES,
} from "../../src/signatures/messages";
import { suppressionReasonCodeSchema } from "../../src/signatures/types";

const REASON_CODES = suppressionReasonCodeSchema.options;

const DELIVER_CODES = ["not_seen_before", "seen_not_delivered"] as const;

describe("SUPPRESSION_REASON_MESSAGES", () => {
  test("should provide a plain-English message for every suppression reason code", () => {
    expect(REASON_CODES.length).toBeGreaterThan(0);
    for (const code of REASON_CODES) {
      expect(Object.hasOwn(SUPPRESSION_REASON_MESSAGES, code)).toBe(true);
      const message = SUPPRESSION_REASON_MESSAGES[code];
      expect(message).not.toBeUndefined();
      if (DELIVER_CODES.includes(code as (typeof DELIVER_CODES)[number])) {
        expect(message).toBeNull();
      } else {
        expect(typeof message).toBe("string");
        expect((message as string).trim().length).toBeGreaterThan(0);
      }
    }

    expect(Object.keys(SUPPRESSION_REASON_MESSAGES).toSorted()).toEqual(
      [...REASON_CODES].toSorted(),
    );
  });

  test("the dismissed message asserts no observation", () => {
    const message = SUPPRESSION_REASON_MESSAGES.dismissed;
    expect(typeof message).toBe("string");
    const lower = (message as string).toLowerCase();

    expect(lower).toContain("not useful");

    for (const claim of [
      "fixed",
      "resolved",
      "stopped",
      "no longer happens",
      "working now",
      "happened again",
      "happening again",
    ]) {
      expect(lower).not.toContain(claim);
    }
  });

  test("already_delivered asserts presentation, never recurrence", () => {
    const message = SUPPRESSION_REASON_MESSAGES.already_delivered;
    expect(typeof message).toBe("string");
    const lower = (message as string).toLowerCase();

    expect(lower).toContain("already told you");

    for (const claim of [
      "again and again",
      "happened again",
      "happening again",
      "keeps happening",
      "still happening",
      "recurring",
      "recurred",
      "once more",
    ]) {
      expect(lower).not.toContain(claim);
    }
  });

  test("deliver decisions produce no customer-facing string", () => {
    for (const code of DELIVER_CODES) {
      expect(SUPPRESSION_REASON_MESSAGES[code]).toBeNull();
    }

    expect(ALL_SUPPRESSION_REASON_MESSAGES.length).toBe(REASON_CODES.length - DELIVER_CODES.length);
  });

  test("doubt reasons never assert health or duplication", () => {
    const doubtCodes = ["unresolvable_ancestry", "unknown_shape_version"] as const;

    for (const code of doubtCodes) {
      const message = SUPPRESSION_REASON_MESSAGES[code];
      expect(typeof message).toBe("string");
      const lower = (message as string).toLowerCase();

      expect(lower).toContain("could not");
      expect(lower).toContain("nothing was posted");

      for (const healthClaim of [
        "nothing happened",
        "nothing went wrong",
        "everything is fine",
        "everything looks fine",
        "all good",
        "healthy",
        "no problems",
        "no issues",
      ]) {
        expect(lower).not.toContain(healthClaim);
      }

      for (const duplicationClaim of [
        "we already told you",
        "duplicate",
        "this is the same",
        "you have seen this before",
        "reported before",
      ]) {
        expect(lower).not.toContain(duplicationClaim);
      }
    }
  });

  test("no product jargon in any customer-facing string", () => {
    expect(ALL_SUPPRESSION_REASON_MESSAGES.length).toBeGreaterThan(0);

    for (const message of ALL_SUPPRESSION_REASON_MESSAGES) {
      const lower = message.toLowerCase();
      for (const word of FORBIDDEN_PRODUCT_JARGON) {
        expect(lower).not.toContain(word);
      }
    }

    const bannedWords: readonly string[] = FORBIDDEN_PRODUCT_JARGON;
    expect(bannedWords.toSorted()).toEqual([
      "candidate",
      "dedup",
      "hash",
      "ledger",
      "policy",
      "signature",
      "suppression",
    ]);
  });
});
