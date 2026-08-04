import { URL_PATH_NORMALISATION_VERSION } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import type { RoledSurface } from "../../src/growth/context";
import {
  DERIVE_MIN_SESSIONS,
  deriveRoledSurfaces,
  proposeRole,
  type SurfaceObservation,
} from "../../src/growth/derive";

const CONFIRMED_AT = new Date("2026-08-01T10:00:00.000Z");
const DERIVED_AT = new Date("2026-08-04T10:00:00.000Z");

function observed(overrides: Partial<SurfaceObservation> = {}): SurfaceObservation {
  return {
    surface: "/reports",
    normalisationVersion: URL_PATH_NORMALISATION_VERSION,
    sessions: 100,
    firstSessionVisitsByReturners: 0,
    visitsByReturningIdentities: 0,
    sessionsAlsoReachingMoney: 0,
    ...overrides,
  };
}

describe("proposeRole", () => {
  test("calls a page where money changes hands what it is, from its address alone", () => {
    for (const surface of ["/checkout", "/settings/billing", "/upgrade-flow", "/pay/subscribe"]) {
      expect(proposeRole(observed({ surface, sessions: 1 })).role).toBe("makes_money");
    }
  });

  test("says nothing about a page barely anyone has reached", () => {
    // A role is a multiplier on what gets shown first. Deriving one from four sessions is
    // guessing, and a guess here is invisible.
    const seen = observed({
      sessions: DERIVE_MIN_SESSIONS - 1,
      visitsByReturningIdentities: DERIVE_MIN_SESSIONS - 1,
    });

    expect(proposeRole(seen).role).toBe("unknown");
  });

  test("calls a page people first meet and then come back past, the first value", () => {
    const seen = observed({ sessions: 100, firstSessionVisitsByReturners: 40 });

    expect(proposeRole(seen)).toEqual({
      role: "first_value",
      basis: "observed_from_behaviour",
    });
  });

  test("calls a page most of whose visits reach money, on the way to money", () => {
    expect(proposeRole(observed({ sessions: 100, sessionsAlsoReachingMoney: 60 })).role).toBe(
      "leads_to_money",
    );
  });

  test("calls a page returning people keep visiting, what brings them back", () => {
    expect(proposeRole(observed({ sessions: 100, visitsByReturningIdentities: 55 })).role).toBe(
      "keeps_people",
    );
  });

  test("gives a page that fits more than one description the one that matters most", () => {
    // Descending by weight, so this is first_value (6) rather than leads_to_money (4).
    const seen = observed({
      sessions: 100,
      firstSessionVisitsByReturners: 40,
      sessionsAlsoReachingMoney: 90,
      visitsByReturningIdentities: 90,
    });

    expect(proposeRole(seen).role).toBe("first_value");
  });

  test("says nothing when no signal clears its share", () => {
    const seen = observed({
      sessions: 100,
      firstSessionVisitsByReturners: 5,
      visitsByReturningIdentities: 5,
      sessionsAlsoReachingMoney: 5,
    });

    expect(proposeRole(seen).role).toBe("unknown");
  });

  test("a page with no sessions is a zero share, never a division by zero", () => {
    const seen = observed({ sessions: 0, visitsByReturningIdentities: 0 });

    expect(proposeRole(seen).role).toBe("unknown");
  });

  test("records behaviour and address as different kinds of claim", () => {
    expect(proposeRole(observed({ surface: "/checkout", sessions: 1 })).basis).toBe(
      "derived_from_product",
    );
    expect(proposeRole(observed({ sessions: 100, visitsByReturningIdentities: 55 })).basis).toBe(
      "observed_from_behaviour",
    );
  });
});

describe("deriveRoledSurfaces", () => {
  function confirmed(surface: string, role: RoledSurface["role"]): RoledSurface {
    return {
      surface,
      role,
      basis: "stated_by_customer",
      confirmedAt: CONFIRMED_AT,
      normalisationVersion: URL_PATH_NORMALISATION_VERSION,
    };
  }

  test("never re-derives over what a person has confirmed", () => {
    // A correction a later run can silently discard is worse than never having asked.
    const derived = deriveRoledSurfaces({
      observations: [observed({ surface: "/checkout", sessions: 100 })],
      existing: [confirmed("/checkout", "keeps_people")],
      derivedAt: DERIVED_AT,
    });

    expect(derived).toHaveLength(1);
    expect(derived[0]?.role).toBe("keeps_people");
    expect(derived[0]?.basis).toBe("stated_by_customer");
    expect(derived[0]?.confirmedAt).toEqual(CONFIRMED_AT);
  });

  test("does re-derive over an earlier proposal nobody confirmed", () => {
    const derived = deriveRoledSurfaces({
      observations: [observed({ surface: "/checkout", sessions: 100 })],
      existing: [
        {
          surface: "/checkout",
          role: "keeps_people",
          basis: "observed_from_behaviour",
          confirmedAt: null,
          normalisationVersion: URL_PATH_NORMALISATION_VERSION,
        },
      ],
      derivedAt: DERIVED_AT,
    });

    expect(derived[0]?.role).toBe("makes_money");
  });

  test("keeps a confirmed page even when it is no longer observed at all", () => {
    const derived = deriveRoledSurfaces({
      observations: [],
      existing: [confirmed("/gone", "first_value")],
      derivedAt: DERIVED_AT,
    });

    expect(derived.map((roled) => roled.surface)).toEqual(["/gone"]);
  });

  test("stores nothing it has nothing to say about", () => {
    const derived = deriveRoledSurfaces({
      observations: [observed({ surface: "/reports", sessions: 100 })],
      existing: [],
      derivedAt: DERIVED_AT,
    });

    expect(derived).toEqual([]);
  });

  test("leaves out a page spelled by a normaliser this build no longer uses", () => {
    const derived = deriveRoledSurfaces({
      observations: [
        observed({
          surface: "/checkout",
          normalisationVersion: URL_PATH_NORMALISATION_VERSION + 1,
        }),
      ],
      existing: [],
      derivedAt: DERIVED_AT,
    });

    expect(derived).toEqual([]);
  });

  test("leaves out a page that is not a normalised address", () => {
    const derived = deriveRoledSurfaces({
      observations: [observed({ surface: "checkout/" })],
      existing: [],
      derivedAt: DERIVED_AT,
    });

    expect(derived).toEqual([]);
  });

  test("marks everything it proposes as unconfirmed, so a person can still be asked", () => {
    const derived = deriveRoledSurfaces({
      observations: [observed({ surface: "/checkout", sessions: 100 })],
      existing: [],
      derivedAt: DERIVED_AT,
    });

    expect(derived[0]?.confirmedAt).toBeNull();
    expect(derived[0]?.normalisationVersion).toBe(URL_PATH_NORMALISATION_VERSION);
  });
});
