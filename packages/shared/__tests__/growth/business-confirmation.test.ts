import { describe, expect, test } from "bun:test";

import { businessFactSchema, readBusinessContext } from "../../src/growth/business";

const AT = new Date("2026-08-05T00:00:00.000Z");

// Typed `string` so the specifier stays unresolvable at compile time: this file must
// typecheck before the AD-3 confirm input schema exists, and fail at run time until it does.
const BUSINESS_MODULE: string = "../../src/growth/business";

type SafeParseable = { safeParse: (value: unknown) => { success: boolean } };

async function loadConfirmInputSchema(): Promise<SafeParseable> {
  const loaded = (await import(BUSINESS_MODULE)) as Record<string, unknown>;
  const schema = loaded["settingsBusinessConfirmInputSchema"] as SafeParseable | undefined;

  if (schema === undefined || typeof schema.safeParse !== "function") {
    throw new Error("src/growth/business.ts must export settingsBusinessConfirmInputSchema (AD-3)");
  }

  return schema;
}

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

function field(value: unknown, name: string): unknown {
  return (value as Record<string, unknown>)[name];
}

describe("confirmation on a business fact", () => {
  test("should parse a legacy fact with no confirmation and no statedBy as nulls", () => {
    const parsed = businessFactSchema.parse(persistedFact("regime"));

    expect(field(parsed, "confirmation")).toBe(null);
    expect(field(field(parsed, "provenance"), "statedBy")).toBe(null);
  });

  test("should round-trip confirmation at and by through businessFactSchema", () => {
    const confirmed = businessFactSchema.parse(
      persistedFact("regime", { confirmation: { at: AT.toISOString(), by: "user_1" } }),
    );
    const confirmation = field(confirmed, "confirmation") as Record<string, unknown> | null;

    expect(confirmation?.["by"]).toBe("user_1");
    expect(confirmation?.["at"]).toEqual(AT);

    const anonymous = businessFactSchema.parse(
      persistedFact("regime", { confirmation: { at: AT.toISOString(), by: null } }),
    );

    expect((field(anonymous, "confirmation") as Record<string, unknown> | null)?.["by"]).toBe(null);
  });

  test("should reject a confirm input missing kind or statement", async () => {
    const schema = await loadConfirmInputSchema();

    expect(schema.safeParse({ statement: "Licensed by the UK Gambling Commission." }).success).toBe(
      false,
    );
    expect(schema.safeParse({ kind: "regime" }).success).toBe(false);
    expect(schema.safeParse({ kind: "regime", statement: "" }).success).toBe(false);

    expect(
      schema.safeParse({ kind: "regime", statement: "Licensed by the UK Gambling Commission." })
        .success,
    ).toBe(true);
  });

  test("should drop a fact whose seen denominator is zero at the read boundary", () => {
    const read = readBusinessContext({
      facts: [
        persistedFact("who_counts", {
          statement: "Buyers who come back within a week.",
          provenance: {
            source: "sessions",
            at: AT.toISOString(),
            citation: null,
            seen: {
              sessions: 0,
              of: 0,
              from: "2026-07-12T00:00:00.000Z",
              to: "2026-07-19T00:00:00.000Z",
            },
          },
        }),
        persistedFact("regime"),
      ],
    });

    expect(read.facts.map((entry) => entry.kind)).toEqual(["regime"]);
  });
});
