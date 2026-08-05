import { describe, expect, test } from "bun:test";

import {
  BINDING_FACT_KINDS,
  BUSINESS_FACT_KINDS,
  FACTS_PER_KIND_MAX,
  OBSERVABLE_FACT_KINDS,
  SHAPING_FACT_KINDS,
  STATED_ONLY_FACT_KINDS,
  bindingReadOutputSchema,
  capFactsPerKind,
  isBindingKind,
  readBusinessContext,
  type BusinessFact,
} from "../../src/growth/business";

const AT = new Date("2026-08-05T00:00:00.000Z");

function persistedFact(kind: string, extra: Record<string, unknown> = {}) {
  return {
    kind,
    statement: "Licensed by the UK Gambling Commission.",
    provenance: { source: "site", at: AT.toISOString(), citation: "https://example.com/terms" },
    correctedFrom: null,
    audience: null,
    ...extra,
  };
}

function fact(kind: BusinessFact["kind"], statement: string): BusinessFact {
  return {
    kind,
    statement,
    provenance: { source: "site", at: AT, citation: "https://example.com/", seen: null },
    correctedFrom: null,
    audience: null,
  };
}

describe("the persisted business context", () => {
  test("drops only the fact it cannot read, never the whole table", () => {
    const read = readBusinessContext({
      facts: [
        persistedFact("regime"),
        persistedFact("what_they_had_for_tea"),
        persistedFact("forbidden_move"),
      ],
    });

    expect(read.facts.map((entry) => entry.kind)).toEqual(["regime", "forbidden_move"]);
  });

  test("reads a column that is not a business context at all as empty rather than throwing", () => {
    expect(readBusinessContext({ beliefs: [] }).facts).toEqual([]);
    expect(readBusinessContext(null).facts).toEqual([]);
  });

  test("defaults the sessions-lane evidence to absent on a row written before it existed", () => {
    const read = readBusinessContext({ facts: [persistedFact("regime")] });

    expect(read.facts[0]?.provenance.seen).toBe(null);
  });

  test("reads a sessions-lane row's counts and window", () => {
    const read = readBusinessContext({
      facts: [
        persistedFact("who_counts", {
          provenance: {
            source: "sessions",
            at: AT.toISOString(),
            citation: null,
            seen: {
              sessions: 41,
              of: 60,
              from: "2026-07-12T00:00:00.000Z",
              to: "2026-07-19T00:00:00.000Z",
            },
          },
        }),
      ],
    });

    expect(read.facts[0]?.provenance.seen?.sessions).toBe(41);
    expect(read.facts[0]?.provenance.seen?.of).toBe(60);
  });

  test("refuses a shaping kind from the model call that reads what binds a business", () => {
    const parsed = bindingReadOutputSchema.safeParse({
      facts: [{ kind: "catalogue_scale", statement: "Thirty thousand things.", citationIndex: 0 }],
    });

    expect(parsed.success).toBe(false);
  });

  test("holds a bounded number of facts per kind so one kind cannot eat the budget", () => {
    const many = Array.from({ length: FACTS_PER_KIND_MAX + 3 }, (_, index) =>
      fact("forbidden_move", `Never do the ${String(index)} thing.`),
    );

    expect(capFactsPerKind([...many, fact("conversion", "An order that arrives.")])).toHaveLength(
      FACTS_PER_KIND_MAX + 1,
    );
  });

  test("caps each kind separately rather than the list as a whole", () => {
    const capped = capFactsPerKind([
      ...Array.from({ length: FACTS_PER_KIND_MAX + 2 }, (_, index) =>
        fact("regime", `Rule ${String(index)}.`),
      ),
      fact("conversion", "An order that arrives."),
    ]);

    expect(capped.filter((entry) => entry.kind === "conversion")).toHaveLength(1);
  });

  test("names the seven that can stop a change shipping and the five that only shape one", () => {
    expect([...BINDING_FACT_KINDS]).toEqual([
      "regime",
      "forbidden_move",
      "load_bearing_friction",
      "conversion",
      "conversion_disqualifier",
      "invalidating_period",
      "who_counts",
    ]);

    expect([...SHAPING_FACT_KINDS]).toEqual([
      "decision_cadence",
      "stake_and_reversibility",
      "arrives_expecting",
      "catalogue_scale",
      "staleness_tolerance",
    ]);

    expect(BUSINESS_FACT_KINDS).toHaveLength(12);
  });

  test("marks every binding kind as binding and no shaping kind as one", () => {
    expect(BINDING_FACT_KINDS.every(isBindingKind)).toBe(true);
    expect(SHAPING_FACT_KINDS.some(isBindingKind)).toBe(false);
  });

  // A lane offering "we see" under a licence is a promise behaviour can never keep, and one
  // offering "your site did not say" under a conversion is waiting for a read that will
  // never answer it.
  test("claims sessions can answer only what people do", () => {
    expect([...OBSERVABLE_FACT_KINDS]).toEqual([
      "who_counts",
      "decision_cadence",
      "arrives_expecting",
    ]);
  });

  test("marks as stated-only every kind no crawl of a website could propose", () => {
    expect([...STATED_ONLY_FACT_KINDS]).toEqual([
      "load_bearing_friction",
      "conversion",
      "conversion_disqualifier",
      "invalidating_period",
      "staleness_tolerance",
    ]);
  });
});
