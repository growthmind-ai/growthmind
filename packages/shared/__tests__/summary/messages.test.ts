import { describe, expect, test } from "bun:test";

import { ALL_DELIVERY_MESSAGES } from "../../src/delivery/messages";
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

  test("Q1 and Q3 produce different customer sentences", () => {
    const q1 = ANALYSIS_OUTCOME_MESSAGES.no_sessions_to_analyse;
    const q3 = ANALYSIS_OUTCOME_MESSAGES.no_candidates_passed_gate;
    expect(q1).not.toBe(q3);
  });

  test("ALL_CUSTOMER_FACING_MESSAGES and ALL_DELIVERY_MESSAGES are unchanged in count from before this sprint", () => {
    expect(ALL_CUSTOMER_FACING_MESSAGES.length).toBe(27);
    expect(ALL_DELIVERY_MESSAGES.length).toBe(24);
  });

  test("floor_model_text_rejected no longer attributes every content rejection to an accuracy check", () => {
    const message = SUMMARY_SOURCE_MESSAGES.floor_model_text_rejected;

    const MIS_ATTRIBUTION = /did\s+not\s+pass\s+our\s+accuracy\s+check/i;
    expect({
      clause: "did not pass our accuracy check",
      present: MIS_ATTRIBUTION.test(message),
    }).toEqual({ clause: "did not pass our accuracy check", present: false });

    const CAUSE_WORDS = [
      /\baccuracy\b/i,
      /\baccurate\b/i,
      /\bprivacy\b/i,
      /\bprivate\b/i,
      /\bpersonal\b/i,
      /\bemail\b/i,
      /\bsentences?\b/i,
    ];
    expect(CAUSE_WORDS.filter((word) => word.test(message)).map((word) => word.source)).toEqual([]);

    const UNMET_CHECK_PHRASES = [
      /\bdid not pass\b/i,
      /\bdid not meet\b/i,
      /\bfailed\b/i,
      /\bwas rejected\b/i,
      /\bcould not be checked\b/i,
    ];
    expect({
      bar: "names that a check was not satisfied",
      satisfied: UNMET_CHECK_PHRASES.some((phrase) => phrase.test(message)),
    }).toEqual({ bar: "names that a check was not satisfied", satisfied: true });

    const sentences = message
      .trim()
      .split(/(?<=\.)\s+/)
      .filter((part) => part.length > 0);
    expect(sentences).toHaveLength(2);
  });

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
