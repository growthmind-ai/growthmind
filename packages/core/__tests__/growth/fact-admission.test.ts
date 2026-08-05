import { FACTS_PER_KIND_MAX, type BusinessFact } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { admitBusinessFacts, admitStatement } from "../../src/growth/fact-admission";

const AT = new Date("2026-08-05T00:00:00.000Z");

function fact(statement: string, kind: BusinessFact["kind"] = "regime"): BusinessFact {
  return {
    kind,
    statement,
    provenance: { source: "site", at: AT, citation: "https://example.com/", seen: null },
    correctedFrom: null,
  };
}

describe("admitStatement", () => {
  test("admits a rule or a segment, which is what this table is for", () => {
    for (const statement of [
      "Licensed by the UK Gambling Commission.",
      "Founders of small software agencies.",
      "Never promote high fat, salt or sugar products on the checkout page.",
    ]) {
      expect(admitStatement(statement)).toEqual({ admitted: true });
    }
  });

  // §5. A model handed a customer's marketing site will find names on it, and the difference
  // between a segment and a named person is a segment versus a dossier.
  test("refuses anything that names one individual", () => {
    for (const statement of [
      "— Jane Smith, CEO of Acme",
      "says Jane Smith",
      "Jane Smith, founder",
      "Ask @janesmith about it",
    ]) {
      expect(admitStatement(statement).admitted).toBe(false);
    }
  });

  test("refuses a statement carrying personal data", () => {
    expect(admitStatement("Teams who email jane@acme.example about it")).toEqual({
      admitted: false,
      refusal: "carries_personal_data",
    });
  });

  test("refuses an empty or oversized statement", () => {
    expect(admitStatement("   ")).toEqual({ admitted: false, refusal: "empty" });
    expect(admitStatement("a".repeat(401))).toEqual({ admitted: false, refusal: "too_long" });
  });

  test("does not mistake a company name for a person's", () => {
    expect(admitStatement("Agencies that resell to companies like Acme").admitted).toBe(true);
  });

  // The near-miss neighbours of the name rule. Every one of these is the sentence its kind
  // exists to hold, and every one was refused as `names_an_individual` while two capitalised
  // words at the start of a statement were enough on their own.
  test("admits a regulator, a season or a place, which are not people", () => {
    for (const statement of [
      "Black Friday is when our numbers do not mean what they usually mean.",
      "Gambling Commission rules forbid advertising to under-25s.",
      "Financial Conduct Authority rules apply to every quote we show.",
      "United Kingdom residents only.",
      "Acme Corp buyers must have a purchase order on file.",
      "Approved by Trading Standards.",
    ]) {
      expect(admitStatement(statement)).toEqual({ admitted: true });
    }
  });
});

describe("admitBusinessFacts", () => {
  test("keeps what passes and drops what does not, rather than repairing it", () => {
    const kept = admitBusinessFacts([
      fact("— Jane Smith, CEO of Acme"),
      fact("Licensed by the UK Gambling Commission."),
    ]);

    expect(kept.map((entry) => entry.statement)).toEqual([
      "Licensed by the UK Gambling Commission.",
    ]);
  });

  test("refuses a fact carrying an email address before it is ever stored", () => {
    expect(admitBusinessFacts([fact("Teams who email jane@acme.example")])).toEqual([]);
  });

  // Without this a model that finds twelve forbidden moves leaves no room for the conversion
  // a person typed.
  test("holds a bounded number per kind so one kind cannot eat the budget", () => {
    const kept = admitBusinessFacts([
      ...Array.from({ length: FACTS_PER_KIND_MAX + 3 }, (_, index) =>
        fact(`Never do the ${String(index)} thing.`, "forbidden_move"),
      ),
      fact("An order that arrives.", "conversion"),
    ]);

    expect(kept.filter((entry) => entry.kind === "forbidden_move")).toHaveLength(
      FACTS_PER_KIND_MAX,
    );
    expect(kept.filter((entry) => entry.kind === "conversion")).toHaveLength(1);
  });

  test("reads an empty list as an empty list", () => {
    expect(admitBusinessFacts([])).toEqual([]);
  });
});
