import { describe, expect, test } from "bun:test";

const AT = new Date("2026-08-05T00:00:00.000Z");

const CONFIRMATION = { at: new Date("2026-08-07T00:00:00.000Z"), by: "user_1" };

// Typed `string` so the specifier stays unresolvable at compile time: this file must
// typecheck before src/growth/confirm-fact.ts exists, and fail at run time until it does.
const CONFIRM_FACT_MODULE: string = "../../src/growth/confirm-fact";

type ConfirmResult = {
  readonly outcome: "confirmed" | "already_confirmed" | "not_found";
  readonly facts: readonly Record<string, unknown>[];
};

type ConfirmInFacts = (
  facts: readonly unknown[],
  kind: string,
  statement: string,
  confirmation: { at: Date; by: string | null },
) => ConfirmResult;

async function loadConfirmInFacts(): Promise<ConfirmInFacts> {
  const loaded = (await import(CONFIRM_FACT_MODULE)) as Record<string, unknown>;
  const confirm = loaded["confirmInFacts"];

  if (typeof confirm !== "function") {
    throw new Error(
      "src/growth/confirm-fact.ts must export confirmInFacts(facts, kind, statement, confirmation) (AD-1)",
    );
  }

  return confirm as ConfirmInFacts;
}

function fact(kind: string, statement: string, extra: Record<string, unknown> = {}) {
  return {
    kind,
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

describe("confirmInFacts stamps a belief a person clicked", () => {
  test("should stamp confirmation on the named fact exactly once", async () => {
    const confirmInFacts = await loadConfirmInFacts();
    const facts = [
      fact("regime", "Licensed by the UK Gambling Commission."),
      // Same sentence under another kind: the confirm names a (kind, statement) pair, not a
      // sentence, so this row must stay untouched.
      fact("forbidden_move", "Licensed by the UK Gambling Commission."),
      fact("conversion", "An order that arrives."),
    ];

    const result = confirmInFacts(
      facts,
      "regime",
      "Licensed by the UK Gambling Commission.",
      CONFIRMATION,
    );

    expect(result.outcome).toBe("confirmed");

    const stamped = result.facts.filter((entry) => entry["confirmation"] !== null);
    expect(stamped).toHaveLength(1);
    expect(stamped[0]?.["kind"]).toBe("regime");
    expect(stamped[0]?.["confirmation"]).toEqual(CONFIRMATION);
  });

  test("should report already_confirmed and change nothing on a second confirm", async () => {
    const confirmInFacts = await loadConfirmInFacts();
    const facts = [fact("regime", "Licensed by the UK Gambling Commission.")];

    const first = confirmInFacts(
      facts,
      "regime",
      "Licensed by the UK Gambling Commission.",
      CONFIRMATION,
    );
    const second = confirmInFacts(
      first.facts,
      "regime",
      "Licensed by the UK Gambling Commission.",
      { at: new Date("2026-08-07T12:00:00.000Z"), by: "user_2" },
    );

    expect(second.outcome).toBe("already_confirmed");
    expect(second.facts).toEqual(first.facts);
  });

  test("should report not_found for a statement that is not in the list", async () => {
    const confirmInFacts = await loadConfirmInFacts();
    const facts = [fact("regime", "Licensed by the UK Gambling Commission.")];
    const before = structuredClone(facts);

    const result = confirmInFacts(facts, "regime", "A sentence nobody stated.", CONFIRMATION);

    expect(result.outcome).toBe("not_found");
    expect(result.facts).toEqual(before);
    expect(facts).toEqual(before);
  });
});
