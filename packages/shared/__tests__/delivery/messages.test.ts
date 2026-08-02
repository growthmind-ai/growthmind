import { describe, expect, test } from "bun:test";

import * as messagesModule from "../../src/delivery/messages";
import {
  ALL_DELIVERY_MESSAGES,
  DELIVERY_DECISION_MESSAGES,
  DELIVERY_STATUS_MESSAGES,
  DELIVERY_VOCABULARY,
  NOTHING_TODAY_LEAD,
  NOTHING_TODAY_REASON_MESSAGES,
  NO_RATE_SENTENCE,
  RESIDUAL_PII_KIND_MESSAGES,
} from "../../src/delivery/messages";
import {
  deliveryDecisionSchema,
  deliveryStatusSchema,
  nothingTodayReasonSchema,
  residualPiiKindSchema,
} from "../../src/delivery/types";
import { FORBIDDEN_PRODUCT_JARGON } from "../../src/signatures/messages";

const COHORT_NOUNS = [
  "people",
  "person",
  "user",
  "users",
  "customer",
  "customers",
  "visitor",
  "visitors",
];

describe("the delivery message map is total over its unions", () => {
  test("every delivery decision has a sentence or an explicit null", () => {
    const decisions = deliveryDecisionSchema.options;
    expect(decisions.length).toBeGreaterThan(0);

    expect(Object.keys(DELIVERY_DECISION_MESSAGES).toSorted()).toEqual([...decisions].toSorted());

    expect(DELIVERY_DECISION_MESSAGES.deliver).toBeNull();
    expect(DELIVERY_DECISION_MESSAGES.nothing_today).toBe(NOTHING_TODAY_LEAD);
  });

  test("every nothing-today reason has a plain-English sentence", () => {
    const reasons = nothingTodayReasonSchema.options;
    expect(Object.keys(NOTHING_TODAY_REASON_MESSAGES).toSorted()).toEqual([...reasons].toSorted());

    for (const reason of reasons) {
      const message = NOTHING_TODAY_REASON_MESSAGES[reason];
      expect(typeof message).toBe("string");
      expect(message.trim().length).toBeGreaterThan(20);
      expect(message.trim().endsWith(".")).toBe(true);
    }
  });

  test("the three quiet days never read as the same day", () => {
    const sentences = Object.values(NOTHING_TODAY_REASON_MESSAGES);
    expect(new Set(sentences).size).toBe(sentences.length);
  });

  test("every delivery status has a sentence or an explicit null", () => {
    const statuses = deliveryStatusSchema.options;
    expect(Object.keys(DELIVERY_STATUS_MESSAGES).toSorted()).toEqual([...statuses].toSorted());

    expect(DELIVERY_STATUS_MESSAGES.posted).toBeNull();
    expect(typeof DELIVERY_STATUS_MESSAGES.pending).toBe("string");
    expect(typeof DELIVERY_STATUS_MESSAGES.failed).toBe("string");
  });

  test("every residual personal-data kind has a sentence", () => {
    const kinds = residualPiiKindSchema.options;
    expect(Object.keys(RESIDUAL_PII_KIND_MESSAGES).toSorted()).toEqual([...kinds].toSorted());
    expect(new Set(Object.values(RESIDUAL_PII_KIND_MESSAGES)).size).toBe(kinds.length);
  });

  test("the vocabulary handed to the renderer is total over the reasons it must render", () => {
    expect(Object.keys(DELIVERY_VOCABULARY.nothingToday).toSorted()).toEqual(
      [...nothingTodayReasonSchema.options].toSorted(),
    );
    expect(DELIVERY_VOCABULARY.nothingTodayLead).toBe(NOTHING_TODAY_LEAD);
    expect(DELIVERY_VOCABULARY.noRate).toBe(NO_RATE_SENTENCE);
  });
});

describe("the plain-English audit", () => {
  test("no customer-facing delivery message contains product jargon", () => {
    expect(ALL_DELIVERY_MESSAGES.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const message of ALL_DELIVERY_MESSAGES) {
      for (const word of FORBIDDEN_PRODUCT_JARGON) {
        if (message.toLowerCase().includes(word)) offenders.push(`${word} in: ${message}`);
      }
    }
    expect(offenders).toEqual([]);

    const banned: readonly string[] = FORBIDDEN_PRODUCT_JARGON;
    expect(banned.toSorted()).toEqual([
      "candidate",
      "dedup",
      "hash",
      "ledger",
      "policy",
      "signature",
      "suppression",
    ]);
  });

  test("no customer-facing delivery message calls a session a person", () => {
    const offenders: string[] = [];
    for (const message of ALL_DELIVERY_MESSAGES) {
      for (const noun of COHORT_NOUNS) {
        if (new RegExp(`\\b${noun}\\b`, "i").test(message)) {
          offenders.push(`${noun} in: ${message}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("no customer-facing delivery message contains engineering vocabulary", () => {
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
      "webhook",
      "job",
    ];

    const offenders: string[] = [];
    for (const message of ALL_DELIVERY_MESSAGES) {
      for (const token of jargon) {
        if (new RegExp(`\\b${token}\\b`, "i").test(message)) {
          offenders.push(`${token} in: ${message}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("every customer-facing delivery message is a whole sentence", () => {
    for (const message of ALL_DELIVERY_MESSAGES) {
      expect(message.trim().length).toBeGreaterThan(20);
      expect(message.trim().endsWith(".")).toBe(true);
      expect(message).toBe(message.trim());
    }
  });

  test("the audit list is complete — every fixed constant is reachable through it", () => {
    const derived = new Set<string>();
    for (const [name, value] of Object.entries(messagesModule)) {
      if (name === "ALL_DELIVERY_MESSAGES") continue;
      if (typeof value === "string") {
        derived.add(value);
      } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        for (const entry of Object.values(value)) {
          if (typeof entry === "string") derived.add(entry);
          else if (typeof entry === "object" && entry !== null) {
            for (const nested of Object.values(entry)) {
              if (typeof nested === "string") derived.add(nested);
            }
          }
        }
      }
    }

    expect(derived.size).toBeGreaterThan(0);
    expect([...derived].toSorted()).toEqual([...ALL_DELIVERY_MESSAGES].toSorted());
  });
});

describe("a sentence keyed by a lane state asserts only what that state establishes", () => {
  test("a quiet day never claims the product is healthy", () => {
    const quiet = [NOTHING_TODAY_LEAD, ...Object.values(NOTHING_TODAY_REASON_MESSAGES)];

    for (const message of quiet) {
      const lower = message.toLowerCase();
      for (const healthClaim of [
        "nothing happened",
        "nothing went wrong",
        "everything is fine",
        "everything looks fine",
        "all good",
        "healthy",
        "no problems",
        "no issues",
        "working well",
      ]) {
        expect(lower).not.toContain(healthClaim);
      }
    }
  });

  test("budget_spent never reads as nothing left to find", () => {
    const lower = NOTHING_TODAY_REASON_MESSAGES.budget_spent.toLowerCase();
    for (const claim of [
      "nothing left",
      "nothing more",
      "nothing else",
      "that is all there is",
      "no more findings",
    ]) {
      expect(lower).not.toContain(claim);
    }

    expect(lower).toContain("on purpose");
  });

  test("a failed delivery never says the finding went away", () => {
    const message = DELIVERY_STATUS_MESSAGES.failed;
    expect(typeof message).toBe("string");
    const lower = String(message).toLowerCase();

    expect(lower).toContain("could not");

    for (const claim of ["no longer", "cancelled", "withdrawn", "was wrong", "gone"]) {
      expect(lower).not.toContain(claim);
    }
  });

  test("no residual personal-data sentence claims certainty or quotes what was found", () => {
    for (const message of Object.values(RESIDUAL_PII_KIND_MESSAGES)) {
      const lower = message.toLowerCase();

      expect(lower).toContain("looked like");
      expect(lower).toContain("held the post back");
      expect(lower).not.toContain("definitely");
      expect(lower).not.toContain("we found the");

      expect(message).not.toMatch(/%s|\{\}|\$\{/);
    }
  });

  test("the no-rate sentence states no percentage at all", () => {
    expect(NO_RATE_SENTENCE).not.toContain("%");
    expect(NO_RATE_SENTENCE).not.toMatch(/\d/);
    expect(NO_RATE_SENTENCE.toLowerCase()).toContain("set aside");
  });
});
