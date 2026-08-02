// The delivery lane's plain-English audit, modelled on the hostile audits at
// `../signatures/messages.test.ts` and `../summary/messages.test.ts`.
//
// Every test name below is an invariant, not a description of a function. A row whose
// test does not exist is a P0 at review, so these names are the contract's index.
//
// The banned vocabulary is imported, never re-listed. `FORBIDDEN_PRODUCT_JARGON` comes
// from `../../src/signatures/messages`, the same list audits against, which is what
// `packages/core/src/counts/measured-count.ts:30` means by " renders one vocabulary
// rather than two". A local copy here would be the second vocabulary, and it would
// drift.
import { describe, expect, test } from "bun:test";

import * as messagesModule from "../../src/delivery/messages";
import {
  ALL_DELIVERY_MESSAGES,
  DELIVERY_DECISION_MESSAGES,
  DELIVERY_LANE_FAILURE_CLAUSE,
  DELIVERY_STATUS_MESSAGES,
  DELIVERY_VOCABULARY,
  NOTHING_TODAY_LEAD,
  NOTHING_TODAY_REASON_MESSAGES,
  NO_RATE_SENTENCE,
  POST_FAILURE_MESSAGES,
  RESIDUAL_PII_KIND_MESSAGES,
  deliveryFailureSentence,
} from "../../src/delivery/messages";
import { postFailureCodeSchema } from "../../src/delivery/poster";
import {
  deliveryDecisionSchema,
  deliveryStatusSchema,
  nothingTodayReasonSchema,
  residualPiiKindSchema,
} from "../../src/delivery/types";
import { FORBIDDEN_PRODUCT_JARGON } from "../../src/signatures/messages";

/**
 * The nouns that turn a session count into a claim about human beings. Identity
 * stitching does not exist in this product
 * (`packages/core/src/counts/measured-count.ts:60-69`), so no string that can sit
 * beside a count may use one.
 */
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

    // Key set from the enum, both directions. A map that grew a stale extra key must
    // fail here too, or this test passes by scanning the wrong set.
    expect(Object.keys(DELIVERY_DECISION_MESSAGES).toSorted()).toEqual([...decisions].toSorted());

    // A delivered finding IS the message. `null`, explicitly, never "".
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
    // FR: these are the distinguishable zeros. "You still owe us an answer", "nothing
    // cleared the bar", and "we are pacing" are three different facts.
    const sentences = Object.values(NOTHING_TODAY_REASON_MESSAGES);
    expect(new Set(sentences).size).toBe(sentences.length);
  });

  test("every delivery status has a sentence or an explicit null", () => {
    const statuses = deliveryStatusSchema.options;
    expect(Object.keys(DELIVERY_STATUS_MESSAGES).toSorted()).toEqual([...statuses].toSorted());

    // The post itself is the evidence a post happened.
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
    // The mitigation, asserted: the renderer receives this object and can therefore
    // never reach a reason with no sentence.
    expect(Object.keys(DELIVERY_VOCABULARY.nothingToday).toSorted()).toEqual(
      [...nothingTodayReasonSchema.options].toSorted(),
    );
    expect(DELIVERY_VOCABULARY.nothingTodayLead).toBe(NOTHING_TODAY_LEAD);
    expect(DELIVERY_VOCABULARY.noRate).toBe(NO_RATE_SENTENCE);
  });
});

describe("the plain-English audit", () => {
  test("no customer-facing delivery message contains product jargon", () => {
    // Non-vacuity: there is something to scan.
    expect(ALL_DELIVERY_MESSAGES.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const message of ALL_DELIVERY_MESSAGES) {
      for (const word of FORBIDDEN_PRODUCT_JARGON) {
        if (message.toLowerCase().includes(word)) offenders.push(`${word} in: ${message}`);
      }
    }
    expect(offenders).toEqual([]);

    // The banned list is the spec's, in full. A shortened list would make the scan above pass
    // by scanning for less. One vocabulary, not two.
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

  // the lesson, reapplied: derive the expected set from the module's actual exports
  // rather than a second hand-maintained list, so a new fixed string is picked up
  // automatically the moment it is exported.
  test("the audit list is complete — every fixed constant is reachable through it", () => {
    const derived = new Set<string>();
    for (const [name, value] of Object.entries(messagesModule)) {
      if (name === "ALL_DELIVERY_MESSAGES") continue;
      if (typeof value === "string") {
        derived.add(value);
      } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        for (const entry of Object.values(value)) {
          // One nesting level deeper, because `DELIVERY_VOCABULARY` bundles a map. A
          // constant hidden inside a nested object would otherwise be exempt from every
          // audit above by accident.
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
    // The SAC-10 shape (`../../src/summary/messages.ts:95-102`): a stated limit must
    // never render as an empty product, or we make a busy product look quiet.
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

    // May assert: we are pacing on purpose, and that is not a fault.
    expect(lower).toContain("on purpose");
  });

  test("a failed delivery never says the finding went away", () => {
    const message = DELIVERY_STATUS_MESSAGES.failed;
    expect(typeof message).toBe("string");
    const lower = String(message).toLowerCase();

    // May assert: we could not get it into Slack, and we will retry.
    expect(lower).toContain("could not");

    // May not assert: anything about the finding itself. A delivery failure is a fact
    // about Slack.
    for (const claim of ["no longer", "cancelled", "withdrawn", "was wrong", "gone"]) {
      expect(lower).not.toContain(claim);
    }
  });

  test("no residual personal-data sentence claims certainty or quotes what was found", () => {
    for (const message of Object.values(RESIDUAL_PII_KIND_MESSAGES)) {
      const lower = message.toLowerCase();

      // May assert: it looked like something, and we held the post back. The gate fails
      // closed on doubt (`packages/core/src/delivery/residual-pii.ts:14-27`), so
      // certainty would be wrong on exactly the cases the gate exists for.
      expect(lower).toContain("looked like");
      expect(lower).toContain("held the post back");
      expect(lower).not.toContain("definitely");
      expect(lower).not.toContain("we found the");

      // And no placeholder into which a caller could interpolate the match. Echoing it
      // would copy the personal data into the place we refused to send it.
      expect(message).not.toMatch(/%s|\{\}|\$\{/);
    }
  });

  // =========================================================================
  // THE FACT / INSTRUCTION SPLIT.
  //
  // `POST_FAILURE_MESSAGES` is read by TWO surfaces — this lane, and the
  // first-run screen through `../../src/onboarding/slack-test.ts`, which
  // appends its own clause to whatever it finds there. A next action written
  // into the shared table is therefore written for one of them and wrong on
  // the other, with nothing in the sentence to say which was meant.
  //
  // It shipped wrong once, exactly that way: `channel_unavailable` ended
  // "Someone will need to pick another one.", the first-run clause added
  // "invite the bot, then send again", and a founder read two contradictory
  // next actions in one paragraph. These rows are what stop it coming back.
  // =========================================================================

  test("no failure sentence in the shared table names an act for somebody to go and do", () => {
    // The scan is over VERBS OF REPAIR aimed at the reader — the acts that
    // differ by surface. It deliberately does NOT ban "we will try again" or
    // "sending the same thing again would not help": those are facts about the
    // lane's own behaviour and about the mechanism, true on every surface, and
    // banning them would be a rule about English rather than about ownership.
    const REPAIR_INSTRUCTION = /\bpick another\b|\bchoose another\b|\binvite\b|\bunarchive\b/i;

    // POSITIVE CONTROL — the exact sentence this rule was written against.
    expect(REPAIR_INSTRUCTION.test("Someone will need to pick another one.")).toBe(true);
    // NEGATIVE CONTROL — a pure statement of what happened does not trip it.
    expect(REPAIR_INSTRUCTION.test("It may have been archived or deleted.")).toBe(false);

    const offenders = Object.entries(POST_FAILURE_MESSAGES)
      .filter(([, message]) => REPAIR_INSTRUCTION.test(message))
      .map(([code, message]) => `${code}: ${message}`);

    expect(offenders).toEqual([]);
  });

  test("the shared table still says the finding is untouched, which is a fact and not an instruction", () => {
    // The half that must survive the split. Removing the instruction must not
    // take this with it: a delivery failure is a fact about Slack, and a
    // customer who is not told the finding is intact assumes it is gone.
    for (const message of Object.values(POST_FAILURE_MESSAGES)) {
      expect(message.toLowerCase()).toContain("nothing about what we found has changed");
    }
  });

  test("the lane's clause map is total over the failure codes", () => {
    const codes = postFailureCodeSchema.options;
    expect(Object.keys(DELIVERY_LANE_FAILURE_CLAUSE).toSorted()).toEqual([...codes].toSorted());

    // Three are silent, and explicitly `null` rather than "". Their facts
    // already carry everything true that this lane can say, and a clause
    // repeating one would be the second answer that started all this.
    expect(DELIVERY_LANE_FAILURE_CLAUSE.call_failed).toBeNull();
    expect(DELIVERY_LANE_FAILURE_CLAUSE.rejected).toBeNull();
    expect(DELIVERY_LANE_FAILURE_CLAUSE.not_authorised).toBeNull();
  });

  test("the lane's one clause names a repair this product actually serves", () => {
    const clause = DELIVERY_LANE_FAILURE_CLAUSE.channel_unavailable;
    expect(typeof clause).toBe("string");
    const lower = String(clause).toLowerCase();

    // MAY: name the two mechanisms that ARE undoable, both of them over in
    // Slack, and say that the lane keeps trying — a `failed` delivery row is
    // re-claimable by a later tick, so that promise is one the lane keeps.
    expect(lower).toContain("unarchive");
    expect(lower).toContain("invite the bot");
    expect(lower).toContain("keep trying");

    // MAY NOT: send anybody after the chosen channel itself. `attachChannel`
    // fills an empty address and never moves a chosen one, and nothing outside
    // tests deactivates a Slack connection — so re-pointing is not an act this
    // product serves on ANY surface, and putting it here would have moved the
    // defect one lane across instead of fixing it.
    expect(lower).not.toContain("pick another");
    expect(lower).not.toContain("choose another");
  });

  test("the lane's composed sentence is the fact then the lane's own next action", () => {
    for (const code of postFailureCodeSchema.options) {
      const composed = deliveryFailureSentence(code);

      // The shipped fact, verbatim and entire, and FIRST. Never a rewrite.
      expect(composed.startsWith(POST_FAILURE_MESSAGES[code])).toBe(true);

      const clause = DELIVERY_LANE_FAILURE_CLAUSE[code];
      if (clause === null) {
        expect(composed).toBe(POST_FAILURE_MESSAGES[code]);
      } else {
        expect(composed).toBe(`${POST_FAILURE_MESSAGES[code]} ${clause}`);
      }
    }
  });

  test("the lane's composed sentence never carries the first-run screen's next action", () => {
    // THE WIRE, ASSERTED FROM THIS END (D11). The two surfaces compose
    // different clauses onto one fact; the failure that matters is one
    // surface's instruction reaching the other, and the only way to know is to
    // read the sentence that actually gets written.
    const composed = deliveryFailureSentence("channel_unavailable");

    // The first-run clause tells a founder to press the send button on the
    // setup card. There is no such button behind a scheduled delivery.
    expect(composed).not.toContain("send the test message again");
    // And exactly one next action, not two.
    expect(composed).not.toContain("pick another");
  });

  test("the no-rate sentence states no percentage at all", () => {
    // : a zero denominator is a reportable state, never "0%" and never NaN.
    expect(NO_RATE_SENTENCE).not.toContain("%");
    expect(NO_RATE_SENTENCE).not.toMatch(/\d/);
    expect(NO_RATE_SENTENCE.toLowerCase()).toContain("set aside");
  });
});
