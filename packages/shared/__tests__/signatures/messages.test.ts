import { describe, expect, test } from "bun:test";

import {
  ALL_SUPPRESSION_REASON_MESSAGES,
  FORBIDDEN_PRODUCT_JARGON,
  SUPPRESSION_REASON_MESSAGES,
} from "../../src/signatures/messages";
import { suppressionReasonCodeSchema } from "../../src/signatures/types";

// One test per row of the prd's String Assertion Contract, with the row's own test
// name. A row whose test does not exist is a P0 at review, so these names are the
// contract's index. Do not rename them without editing the prd table.

/** The vocabulary itself, read from the Zod enum. Never a hand-list: a hand-list is
 * exactly how a new reason code ships with no message. */
const REASON_CODES = suppressionReasonCodeSchema.options;

/** The two codes whose decision is deliver. Everything else suppresses. */
const DELIVER_CODES = ["not_seen_before", "seen_not_delivered"] as const;

describe("SUPPRESSION_REASON_MESSAGES", () => {
  test("should provide a plain-English message for every suppression reason code", () => {
    // The enum is the source of truth for the key set. Enumerate it, so adding a code
    // without a message fails here rather than rendering `undefined` to a customer.
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

    // Non-vacuity: the map holds no keys the enum does not name either, so this test
    // cannot pass by the map having grown a stale extra entry.
    expect(Object.keys(SUPPRESSION_REASON_MESSAGES).toSorted()).toEqual(
      [...REASON_CODES].toSorted(),
    );
  });

  test("the dismissed message asserts no observation", () => {
    const message = SUPPRESSION_REASON_MESSAGES.dismissed;
    expect(typeof message).toBe("string");
    const lower = (message as string).toLowerCase();

    // May assert: a person on the team decided, and it will not come back.
    expect(lower).toContain("not useful");

    // May not assert: that the underlying problem is fixed or stopped. The ledger knows
    // a decision was recorded, not a state of the product.
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

    // May assert: that we reported it before. That is a fact about US.
    expect(lower).toContain("already told you");

    // May not assert: that it recurred. We know what we sent, not what a user hit
    // since. This is the failure, spelled out.
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
    // A deliver decision is not a thing we say anything about. The finding itself is
    // the message. `null`, explicitly, never "" and never a placeholder sentence.
    for (const code of DELIVER_CODES) {
      expect(SUPPRESSION_REASON_MESSAGES[code]).toBeNull();
    }

    // And they contribute nothing to the audited set.
    expect(ALL_SUPPRESSION_REASON_MESSAGES.length).toBe(REASON_CODES.length - DELIVER_CODES.length);
  });

  test("doubt reasons never assert health or duplication", () => {
    const doubtCodes = ["unresolvable_ancestry", "unknown_shape_version"] as const;

    for (const code of doubtCodes) {
      const message = SUPPRESSION_REASON_MESSAGES[code];
      expect(typeof message).toBe("string");
      const lower = (message as string).toLowerCase();

      // May assert: we are not certain, so we held back and posted nothing.
      expect(lower).toContain("could not");
      expect(lower).toContain("nothing was posted");

      // May not assert: that the product is healthy / nothing happened.
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

      // May not assert: that this IS a repeat. Doubt is not a verdict.
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
    // Non-vacuity: there is something to scan.
    expect(ALL_SUPPRESSION_REASON_MESSAGES.length).toBeGreaterThan(0);

    for (const message of ALL_SUPPRESSION_REASON_MESSAGES) {
      const lower = message.toLowerCase();
      for (const word of FORBIDDEN_PRODUCT_JARGON) {
        expect(lower).not.toContain(word);
      }
    }

    // The banned list is the prd's, in full. A shortened list would make the scan above
    // pass by scanning for less.
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
