import { describe, expect, test } from "bun:test";

import { SURFACE_ROLES } from "@growthmind/shared";

import {
  UNWEIGHTED,
  WORTH_WEIGHT_VERSION,
  isSurfaceWorth,
  surfaceWorth,
  unknownWorth,
  weightOfRole,
} from "../../src/growth/surface-worth";

const CONFIRMED = new Date("2026-08-01T10:00:00.000Z");

describe("surfaceWorth", () => {
  test("stamps the weight and the weight version from the role", () => {
    const worth = surfaceWorth({
      surface: "/checkout",
      role: "makes_money",
      basis: "stated_by_customer",
      confirmedAt: CONFIRMED,
    });

    expect(worth.weight).toBe(weightOfRole("makes_money"));
    expect(worth.weightVersion).toBe(WORTH_WEIGHT_VERSION);
    expect(worth.confirmedAt).toEqual(CONFIRMED);
  });

  test("refuses a surface that is not a normalised url path", () => {
    expect(() =>
      surfaceWorth({
        surface: "/orders/8ac3f21b-1f2e-4c8d-9f77-2b1d5e6a7c90",
        role: "makes_money",
        basis: "stated_by_customer",
        confirmedAt: null,
      }),
    ).toThrow(/surface_worth_not_normalised/);
  });

  test("refuses a role that is not one of the stated roles", () => {
    expect(() =>
      surfaceWorth({
        surface: "/checkout",
        // @ts-expect-error — the point of the test is the runtime refusal
        role: "very_important",
        basis: "stated_by_customer",
        confirmedAt: null,
      }),
    ).toThrow();
  });

  test("an unconfirmed proposal is still worth, carrying a null confirmation", () => {
    const worth = surfaceWorth({
      surface: "/welcome",
      role: "first_value",
      basis: "derived_from_product",
      confirmedAt: null,
    });

    expect(worth.confirmedAt).toBeNull();
    expect(worth.weight).toBe(weightOfRole("first_value"));
  });

  test("every role weighs at least one, and only unknown weighs exactly one", () => {
    for (const role of SURFACE_ROLES) {
      expect(weightOfRole(role)).toBeGreaterThanOrEqual(UNWEIGHTED);
    }

    expect(SURFACE_ROLES.filter((role) => weightOfRole(role) === UNWEIGHTED)).toEqual(["unknown"]);
  });

  test("a plain object is not worth, however well shaped", () => {
    expect(
      isSurfaceWorth({
        surface: "/checkout",
        role: "makes_money",
        weight: 8,
        weightVersion: 1,
        basis: "stated_by_customer",
        confirmedAt: null,
      }),
    ).toBe(false);

    expect(
      isSurfaceWorth(
        surfaceWorth({
          surface: "/checkout",
          role: "makes_money",
          basis: "stated_by_customer",
          confirmedAt: null,
        }),
      ),
    ).toBe(true);
  });
});

describe("unknownWorth", () => {
  test("weighs one, so it cannot move an ordering", () => {
    expect(unknownWorth("/anything").weight).toBe(UNWEIGHTED);
  });

  test("never throws on a surface the constructor would refuse", () => {
    // The absence path holds whatever the finding row carries. A throw here would cost
    // that finding its delivery over a weight that changes no ordering.
    const worth = unknownWorth("/orders/8ac3f21b-1f2e-4c8d-9f77-2b1d5e6a7c90?utm=x");

    expect(worth.weight).toBe(UNWEIGHTED);
    expect(isSurfaceWorth(worth)).toBe(true);
  });

  test("never throws on an empty surface", () => {
    expect(unknownWorth("").weight).toBe(UNWEIGHTED);
  });
});
