import { describe, expect, test } from "bun:test";

import {
  ALL_DELIVERY_MESSAGES,
  DELIVERY_LANE_DECISION_MESSAGES,
  DELIVERY_STATUS_MESSAGES,
  NOTHING_TODAY_REASON_MESSAGES,
  POST_FAILURE_MESSAGES,
  RESIDUAL_PII_KIND_MESSAGES,
  deliveryFailureSentence,
} from "../../src/delivery/messages";
import { postFailureCodeSchema } from "../../src/delivery/poster";
import {
  DELIVERY_REASON_CODES,
  DELIVERY_REASON_SENTENCES,
  NOT_DELIVERED_REASON_CODE,
  deliveryReasonCodeSchema,
  deliveryReasonSentence,
  laneDecisionReasonCode,
  nothingTodayReasonCode,
  postFailureReasonCode,
  residualPiiReasonCode,
} from "../../src/delivery/reason-code";
import {
  deliveryLaneDecisionSchema,
  nothingTodayReasonSchema,
  residualPiiKindSchema,
} from "../../src/delivery/types";

describe("the reason code is what decides a run, and the sentence is what it says", () => {
  test("the exported array and the schema name the same codes", () => {
    expect([...DELIVERY_REASON_CODES].toSorted()).toEqual(
      [...deliveryReasonCodeSchema.options].toSorted(),
    );
    expect(new Set(DELIVERY_REASON_CODES).size).toBe(DELIVERY_REASON_CODES.length);
  });

  test("every code has a sentence and every sentence is one Growthmind wrote", () => {
    expect(Object.keys(DELIVERY_REASON_SENTENCES).toSorted()).toEqual(
      [...DELIVERY_REASON_CODES].toSorted(),
    );

    for (const code of DELIVERY_REASON_CODES) {
      const sentence = deliveryReasonSentence(code);
      expect(sentence.trim().length).toBeGreaterThan(20);

      // Composed failure sentences are a fact plus the lane's own clause, so they are matched
      // by the constant they start from rather than as a whole.
      const known = ALL_DELIVERY_MESSAGES.some((message) => sentence.includes(message));
      expect({ code, known }).toEqual({ code, known: true });
    }
  });

  // The pairing that must not drift. Nothing type-checks a copy pass, so the only defence is
  // that the code resolves back to the very constant the tick would otherwise have inlined.
  test("each family's code resolves to that family's own sentence", () => {
    for (const decision of deliveryLaneDecisionSchema.options) {
      expect(deliveryReasonSentence(laneDecisionReasonCode(decision))).toBe(
        DELIVERY_LANE_DECISION_MESSAGES[decision],
      );
    }

    for (const reason of nothingTodayReasonSchema.options) {
      expect(deliveryReasonSentence(nothingTodayReasonCode(reason))).toBe(
        NOTHING_TODAY_REASON_MESSAGES[reason],
      );
    }

    for (const kind of residualPiiKindSchema.options) {
      expect(deliveryReasonSentence(residualPiiReasonCode(kind))).toBe(
        RESIDUAL_PII_KIND_MESSAGES[kind],
      );
    }

    for (const code of postFailureCodeSchema.options) {
      const sentence = deliveryReasonSentence(postFailureReasonCode(code));
      expect(sentence).toBe(deliveryFailureSentence(code));
      expect(sentence.startsWith(POST_FAILURE_MESSAGES[code])).toBe(true);
    }

    expect(deliveryReasonSentence(NOT_DELIVERED_REASON_CODE)).toBe(
      String(DELIVERY_STATUS_MESSAGES.failed),
    );
  });

  test("no two families share a code, so a lane's answer is never confused with another's", () => {
    const minted = [
      ...deliveryLaneDecisionSchema.options.map(laneDecisionReasonCode),
      ...nothingTodayReasonSchema.options.map(nothingTodayReasonCode),
      ...residualPiiKindSchema.options.map(residualPiiReasonCode),
      ...postFailureCodeSchema.options.map(postFailureReasonCode),
      NOT_DELIVERED_REASON_CODE,
    ];

    expect(new Set(minted).size).toBe(minted.length);

    // Every code a tick can mint is a code the column accepts, and nothing else exists.
    expect([...minted].toSorted()).toEqual([...DELIVERY_REASON_CODES].toSorted());
  });

  // The whole point of the split: rewording is a copy decision, not a data-model one.
  test("a code carries none of its sentence, so rewording cannot change it", () => {
    for (const code of DELIVERY_REASON_CODES) {
      expect(code).toMatch(/^[a-z][a-z_]*$/);
      expect(code.includes(" ")).toBe(false);
      expect(deliveryReasonSentence(code)).not.toContain(code);
    }
  });
});
