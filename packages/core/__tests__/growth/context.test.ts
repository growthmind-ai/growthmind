import { describe, expect, test } from "bun:test";

import {
  EMPTY_GROWTH_CONTEXT,
  growthContext,
  growthContextSchema,
  proposalScopeOf,
  worthOf,
} from "../../src/growth/context";
import { UNWEIGHTED, weightOfRole } from "../../src/growth/surface-worth";

const CHECKOUT = {
  surface: "/checkout",
  role: "makes_money",
  basis: "stated_by_customer",
  confirmedAt: new Date("2026-08-01T10:00:00.000Z"),
} as const;

function contextWith(...surfaces: readonly (typeof CHECKOUT)[]) {
  return growthContext({ surfaces: [...surfaces], confirmedChangeable: [] });
}

describe("worthOf", () => {
  test("weighs every surface the same when there is no context at all", () => {
    expect(worthOf(null, "/checkout").weight).toBe(UNWEIGHTED);
    expect(worthOf(null, "/checkout").role).toBe("unknown");
  });

  test("weighs a surface the context does not mention the same as no context", () => {
    const context = contextWith(CHECKOUT);

    expect(worthOf(context, "/dashboard").weight).toBe(UNWEIGHTED);
    expect(worthOf(context, "/dashboard").role).toBe("unknown");
  });

  test("returns the roled weight for a surface the context names", () => {
    const worth = worthOf(contextWith(CHECKOUT), "/checkout");

    expect(worth.role).toBe("makes_money");
    expect(worth.weight).toBe(weightOfRole("makes_money"));
    expect(worth.confirmedAt).toEqual(CHECKOUT.confirmedAt);
  });

  test("matches a surface exactly, never by prefix", () => {
    const context = contextWith(CHECKOUT);

    expect(worthOf(context, "/checkout/payment").weight).toBe(UNWEIGHTED);
  });

  test("an empty context is the same answer as no context", () => {
    expect(worthOf(EMPTY_GROWTH_CONTEXT, "/checkout").weight).toBe(
      worthOf(null, "/checkout").weight,
    );
  });

  test("never throws on a surface the finding row happens to carry", () => {
    expect(worthOf(null, "").weight).toBe(UNWEIGHTED);
    expect(worthOf(contextWith(CHECKOUT), "/orders/7f3a?utm=x").weight).toBe(UNWEIGHTED);
  });
});

describe("growthContextSchema", () => {
  test("refuses a stored surface that is not normalised, so the reader can answer absence", () => {
    // One bad row costs the project its weighting, not its delivery: the repository logs
    // and returns null, and null is "weigh everything the same".
    expect(() =>
      growthContext({
        surfaces: [{ ...CHECKOUT, surface: "/orders/8ac3f21b-1f2e-4c8d-9f77-2b1d5e6a7c90" }],
        confirmedChangeable: [],
      }),
    ).toThrow();
  });

  test("refuses a role that is not one of the stated roles", () => {
    expect(() =>
      growthContext({
        surfaces: [{ ...CHECKOUT, role: "very_important" as unknown as typeof CHECKOUT.role }],
        confirmedChangeable: [],
      }),
    ).toThrow();
  });

  test("reads a confirmedAt back from an ISO string, as a jsonb column returns it", () => {
    const parsed = growthContextSchema.parse({
      surfaces: [{ ...CHECKOUT, confirmedAt: "2026-08-01T10:00:00.000Z" }],
      confirmedChangeable: [],
    });

    expect(parsed.surfaces[0]?.confirmedAt).toEqual(CHECKOUT.confirmedAt);
  });

  test("accepts an empty record, which is what a project starts with", () => {
    const context = growthContext({ surfaces: [], confirmedChangeable: [] });

    expect(worthOf(context, "/checkout").weight).toBe(UNWEIGHTED);
  });

  test("the last entry wins when a surface is roled twice", () => {
    const context = growthContext({
      surfaces: [
        { ...CHECKOUT, role: "keeps_people" },
        { ...CHECKOUT, role: "makes_money" },
      ],
      confirmedChangeable: [],
    });

    expect(worthOf(context, "/checkout").role).toBe("makes_money");
  });
});

describe("proposalScopeOf", () => {
  test("is empty when there is no context, so the deny list decides alone", () => {
    expect(proposalScopeOf(null).confirmedChangeable.size).toBe(0);
  });

  test("carries the customer's confirmed list through", () => {
    const context = growthContext({
      surfaces: [],
      confirmedChangeable: ["/blog/pricing-strategy"],
    });

    expect(proposalScopeOf(context).confirmedChangeable.has("/blog/pricing-strategy")).toBe(true);
  });
});
