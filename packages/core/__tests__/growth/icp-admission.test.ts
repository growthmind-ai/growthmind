import { ICP_STATEMENT_MAX, type IcpBelief } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { admitIcpBeliefs, admitIcpStatement } from "../../src/growth/icp-admission";

function belief(statement: string): IcpBelief {
  return {
    kind: "who_it_is_for",
    statement,
    provenance: { source: "site", at: new Date("2026-08-04T00:00:00.000Z"), citation: null },
    correctedFrom: null,
  };
}

describe("admitIcpStatement", () => {
  test("admits a statement about a group of people", () => {
    for (const statement of [
      "Founders of small software agencies who bill by the project",
      "People who have shipped something and cannot tell whether anyone uses it",
      "Teams building with a coding assistant before they would hire for growth",
    ]) {
      expect(admitIcpStatement(statement)).toEqual({ admitted: true });
    }
  });

  test("refuses a statement naming one person", () => {
    // §5: this table describes segments. A marketing site is full of names — a founder's,
    // a testimonial's — and a model handed one will repeat them back.
    for (const statement of [
      "— Jane Smith, CEO of Acme",
      "Jane Smith, founder, says it saved her team a week",
      "Recommended by @janesmith",
    ]) {
      expect(admitIcpStatement(statement).admitted).toBe(false);
    }
  });

  test("refuses a statement carrying personal data, through the same seam Slack uses", () => {
    expect(admitIcpStatement("Teams who email jane@acme.example about it")).toEqual({
      admitted: false,
      refusal: "carries_personal_data",
    });
  });

  test("refuses an empty statement and one past the cap", () => {
    expect(admitIcpStatement("   ")).toEqual({ admitted: false, refusal: "empty" });
    expect(admitIcpStatement("a".repeat(ICP_STATEMENT_MAX + 1))).toEqual({
      admitted: false,
      refusal: "too_long",
    });
  });

  test("admits a company name, which is not an individual", () => {
    expect(admitIcpStatement("Agencies that resell to companies like Acme").admitted).toBe(true);
  });
});

describe("admitIcpBeliefs", () => {
  test("drops the refused rows and keeps the rest", () => {
    const kept = admitIcpBeliefs([
      belief("Founders of small agencies"),
      belief("— Jane Smith, CEO"),
      belief("Teams shipping weekly"),
    ]);

    expect(kept.map((row) => row.statement)).toEqual([
      "Founders of small agencies",
      "Teams shipping weekly",
    ]);
  });

  test("never repairs a refused row into a passing one", () => {
    // Editing a model's sentence to make it pass would put words in the table that nothing
    // said and nothing can be held to.
    expect(admitIcpBeliefs([belief("jane@acme.example runs the team")])).toEqual([]);
  });

  test("an empty read is an empty table, not an error", () => {
    expect(admitIcpBeliefs([])).toEqual([]);
  });
});
