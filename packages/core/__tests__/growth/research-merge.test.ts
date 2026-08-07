import { BUSINESS_FACT_LIMIT, FACTS_PER_KIND_MAX } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

const AT = new Date("2026-08-05T00:00:00.000Z");

const CONFIRMED = { at: new Date("2026-08-06T00:00:00.000Z"), by: "user_1" };

// Typed `string` so the specifier stays unresolvable at compile time: this file must
// typecheck before src/growth/research-merge.ts exists, and fail at run time until it does.
const RESEARCH_MERGE_MODULE: string = "../../src/growth/research-merge";

type MergedContext = {
  readonly facts: readonly Record<string, unknown>[];
  readonly removed: readonly string[];
};

type MergeResearch = (current: unknown, incoming: readonly unknown[]) => MergedContext;

async function loadMergeResearch(): Promise<MergeResearch> {
  const loaded = (await import(RESEARCH_MERGE_MODULE)) as Record<string, unknown>;
  const merge = loaded["mergeResearch"];

  if (typeof merge !== "function") {
    throw new Error(
      "src/growth/research-merge.ts must export mergeResearch(current, incoming) (AD-2)",
    );
  }

  return merge as MergeResearch;
}

function siteFact(statement: string, extra: Record<string, unknown> = {}) {
  return {
    kind: "regime",
    statement,
    provenance: {
      source: "site",
      at: AT,
      citation: "https://example.com/terms",
      seen: null,
      statedBy: null,
    },
    correctedFrom: null,
    audience: null,
    confirmation: null,
    ...extra,
  };
}

function statedFact(statement: string, extra: Record<string, unknown> = {}) {
  return {
    kind: "regime",
    statement,
    provenance: {
      source: "stated_by_customer",
      at: AT,
      citation: null,
      seen: null,
      statedBy: "user_1",
    },
    correctedFrom: null,
    audience: null,
    confirmation: null,
    ...extra,
  };
}

function context(facts: readonly unknown[], removed: readonly string[] = []) {
  return { facts, removed };
}

function statements(merged: MergedContext): readonly unknown[] {
  return merged.facts.map((fact) => fact["statement"]);
}

describe("mergeResearch across a re-read of the site", () => {
  test("should keep a confirmed site-sourced fact with its confirmation across a re-research merge", async () => {
    const mergeResearch = await loadMergeResearch();
    const confirmed = siteFact("Licensed by the UK Gambling Commission.", {
      confirmation: CONFIRMED,
    });

    const merged = mergeResearch(context([confirmed]), [
      siteFact("Licensed by the UK Gambling Commission."),
      siteFact("Ships to the UK only."),
    ]);

    const licensed = merged.facts.filter(
      (fact) => fact["statement"] === "Licensed by the UK Gambling Commission.",
    );

    expect(licensed).toHaveLength(1);
    expect(licensed[0]?.["confirmation"]).toEqual(CONFIRMED);
    expect(statements(merged)).toContain("Ships to the UK only.");
  });

  test("should keep a correction and never re-propose its correctedFrom statement", async () => {
    const mergeResearch = await loadMergeResearch();
    const corrected = statedFact("Ships worldwide except the US.", {
      correctedFrom: "Ships worldwide.",
    });

    const merged = mergeResearch(context([corrected]), [
      siteFact("Ships worldwide."),
      siteFact("Ships worldwide except the US."),
    ]);

    expect(statements(merged)).toEqual(["Ships worldwide except the US."]);
    expect(merged.facts[0]?.["correctedFrom"]).toBe("Ships worldwide.");
  });

  test("should never re-add a removed statement on re-research", async () => {
    const mergeResearch = await loadMergeResearch();

    const merged = mergeResearch(context([], ["Free returns for 90 days."]), [
      siteFact("Free returns for 90 days."),
    ]);

    expect(statements(merged)).toEqual([]);
    expect(merged.removed).toEqual(["Free returns for 90 days."]);
  });

  test("should replace an unconfirmed site fact with the incoming read", async () => {
    const mergeResearch = await loadMergeResearch();

    const merged = mergeResearch(context([siteFact("The old sentence the site no longer says.")]), [
      siteFact("The sentence the site says now."),
    ]);

    expect(statements(merged)).toEqual(["The sentence the site says now."]);
  });

  test("should cap merged facts per kind with person-stated facts leading", async () => {
    const mergeResearch = await loadMergeResearch();
    const kept = [
      statedFact("Stated one."),
      statedFact("Stated two."),
      statedFact("Stated three."),
    ];
    const incoming = [
      siteFact("Incoming one."),
      siteFact("Incoming two."),
      siteFact("Incoming three."),
    ];

    const merged = mergeResearch(context(kept), incoming);
    const ofKind = merged.facts.filter((fact) => fact["kind"] === "regime");

    expect(ofKind).toHaveLength(FACTS_PER_KIND_MAX);
    expect(ofKind.slice(0, 3).map((fact) => fact["statement"])).toEqual([
      "Stated one.",
      "Stated two.",
      "Stated three.",
    ]);
    expect(merged.facts.length).toBeLessThanOrEqual(BUSINESS_FACT_LIMIT);
  });
});
