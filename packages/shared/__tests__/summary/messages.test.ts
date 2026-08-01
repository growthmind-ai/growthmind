// "Degradation states, enum totality" + the plain-English audit over the one home every
// customer-facing string this lane produces lives in
// (`packages/shared/src/summary/messages.ts`), modelled on the hostile audit at
// `packages/shared/__tests__/session-source/messages.test.ts`.
//
// This module keeps its own `ALL_CUSTOMER_FACING_MESSAGES` rather than merging into
// `session-source/messages.ts`'s export of the same name. T1.1 is scoped to files under
// `packages/shared/src/summary/**` and `packages/shared/src/env.ts` only, and
// `session-source/messages.ts` is outside that scope. The audit below is therefore
// total over this module's exports, the same way the gate messages were total over
// theirs before being folded into the session-source list.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

import * as messagesModule from "../../src/summary/messages";
import {
  ALL_CUSTOMER_FACING_MESSAGES,
  ANALYSIS_OUTCOME_MESSAGES,
  ANALYSIS_RUN_STATUS_MESSAGES,
  ANALYSIS_STOP_REASON_MESSAGES,
  SUMMARY_SOURCE_MESSAGES,
} from "../../src/summary/messages";
import {
  analysisOutcomeSchema,
  analysisRunStatusSchema,
  analysisStopReasonSchema,
  summarySourceSchema,
} from "../../src/summary/types";

const TYPES_SOURCE = readFileSync(
  fileURLToPath(new URL("../../src/summary/types.ts", import.meta.url)),
  "utf8",
);

/** Every string this lane can put in front of a customer. No templated builders in this
 * module (unlike session-source's), so this is just the fixed table. */
function everyMessage(): string[] {
  return [...ALL_CUSTOMER_FACING_MESSAGES];
}

describe("the plain-English audit", () => {
  test("no exported customer-facing message contains a forbidden jargon token", () => {
    const jargon = [
      "tenant",
      "adapter",
      "endpoint",
      "null",
      "undefined",
      "schema",
      "enum",
      "payload",
      "idempotent",
    ];

    const offenders: string[] = [];
    for (const message of everyMessage()) {
      for (const token of jargon) {
        if (new RegExp(`\\b${token}\\b`, "i").test(message)) {
          offenders.push(`${token} in: ${message}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("no exported customer-facing message contains a bare HTTP status code", () => {
    const BARE_STATUS = /\b[1-5]\d{2}\b/;
    const offenders = everyMessage().filter((message) => BARE_STATUS.test(message));
    expect(offenders).toEqual([]);
  });

  // the lesson: derive the expected set from the module's actual exports rather than a
  // second hand-maintained list, so a new fixed string constant is picked up
  // automatically the moment it is exported.
  test("the audit list is complete — every fixed constant is reachable through it", () => {
    const derivedFromExports: string[] = [];
    for (const [name, value] of Object.entries(messagesModule)) {
      if (name === "ALL_CUSTOMER_FACING_MESSAGES") continue;
      if (typeof value === "string") {
        derivedFromExports.push(value);
      } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        for (const entry of Object.values(value)) {
          if (typeof entry === "string") derivedFromExports.push(entry);
        }
      }
    }

    const registered = new Set(ALL_CUSTOMER_FACING_MESSAGES);
    const missing = derivedFromExports.filter((message) => !registered.has(message));
    expect(missing).toEqual([]);
    expect(ALL_CUSTOMER_FACING_MESSAGES.length).toBe(derivedFromExports.length);
  });
});

describe("degradation states — enum totality", () => {
  // .
  test("every summary_source member has a comment explaining what it means to a customer", () => {
    const enumBlockMatch = TYPES_SOURCE.match(/summarySourceSchema = z\.enum\(\[([\s\S]*?)\]\);/);
    expect(enumBlockMatch).not.toBeNull();
    const block = enumBlockMatch![1];

    for (const member of summarySourceSchema.options) {
      const commentedMemberPattern = new RegExp(`/\\*\\*[\\s\\S]*?\\*/\\s*"${member}"`);
      expect(commentedMemberPattern.test(block)).toBe(true);
    }
  });

  // .
  test("every degradation state has a distinct customer sentence", () => {
    const all = [
      ...Object.values(ANALYSIS_RUN_STATUS_MESSAGES),
      ...Object.values(ANALYSIS_OUTCOME_MESSAGES),
      ...Object.values(ANALYSIS_STOP_REASON_MESSAGES),
      ...Object.values(SUMMARY_SOURCE_MESSAGES),
    ];
    expect(new Set(all).size).toBe(all.length);

    for (const message of all) {
      expect(message.trim().length).toBeGreaterThan(20);
      expect(message.trim().endsWith(".")).toBe(true);
    }
  });

  // The closed-enum rule is enforced at the type level today. Every enum is a closed Zod
  // union, never a nullable field standing in for a state, and the test below confirms
  // each schema is total over its declared members with no additional
  // `null`/`undefined` arm.
  //
  // The wire half is not enforced yet, and this comment previously claimed it was: it
  // cited `worker/__tests__/cold-start-analysis.test.ts`, which does not exist. No
  // worker task, no wire, and no such test ship in this sprint. Writing that task
  // carries the inherited obligation of asserting at the wire. That a run row surfaces
  // one of these closed states and never a null standing in for one. Type-level
  // totality alone cannot catch a wire that writes a state this union never declared.
  test("every enum member has exactly one registered message and no schema admits null", () => {
    expect(Object.keys(ANALYSIS_RUN_STATUS_MESSAGES).toSorted()).toEqual(
      [...analysisRunStatusSchema.options].toSorted(),
    );
    expect(Object.keys(ANALYSIS_OUTCOME_MESSAGES).toSorted()).toEqual(
      [...analysisOutcomeSchema.options].toSorted(),
    );
    expect(Object.keys(ANALYSIS_STOP_REASON_MESSAGES).toSorted()).toEqual(
      [...analysisStopReasonSchema.options].toSorted(),
    );
    expect(Object.keys(SUMMARY_SOURCE_MESSAGES).toSorted()).toEqual(
      [...summarySourceSchema.options].toSorted(),
    );

    expect(analysisRunStatusSchema.safeParse(null).success).toBe(false);
    expect(analysisOutcomeSchema.safeParse(undefined).success).toBe(false);
    expect(analysisStopReasonSchema.safeParse(null).success).toBe(false);
    expect(summarySourceSchema.safeParse(undefined).success).toBe(false);
  });

  // "we have not looked yet" vs "we looked and your product was quiet"
  // (`packages/db/src/services/connection-state.ts:36-50`).
  test("Q1 and Q3 produce different customer sentences", () => {
    const q1 = ANALYSIS_OUTCOME_MESSAGES.no_sessions_to_analyse;
    const q3 = ANALYSIS_OUTCOME_MESSAGES.no_candidates_passed_gate;
    expect(q1).not.toBe(q3);
  });

  // SAC-6, the regression: read `packages/shared/src/gate/messages.ts:58-85` before
  // touching this test. A degradation sentence keyed by `summary_source` alone is
  // emitted for every cause that member covers, so it may only assert that a written
  // explanation is absent, never a positive claim about what was observed in the
  // customer's product, which the sentence cannot know.
  test("no _unsatisfied or degradation sentence contains a positive-observation phrasing", () => {
    const POSITIVE_OBSERVATION_PHRASES = [
      /\bwe saw\b/i,
      /\bwe found\b/i,
      /\bwe observed\b/i,
      /\bconfirmed\b/i,
      /\bproves?\b/i,
      /\bshows that\b/i,
      /\bpeople (are|were|have|struggled|succeeded|failed)\b/i,
    ];

    const degradationSentences = Object.entries(SUMMARY_SOURCE_MESSAGES)
      .filter(([key]) => key.startsWith("floor_"))
      .map(([, message]) => message);

    expect(degradationSentences).toHaveLength(5);

    const offenders: string[] = [];
    for (const message of degradationSentences) {
      for (const phrase of POSITIVE_OBSERVATION_PHRASES) {
        if (phrase.test(message)) offenders.push(`${phrase} in: ${message}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
