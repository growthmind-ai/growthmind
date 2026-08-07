import { describe, expect, test } from "bun:test";
import type { BusinessContext, BusinessFact } from "@growthmind/shared";

import { hasAnyFact, toBindingLanes, toShapingLanes } from "../../lib/settings/business";

const AT = new Date("2026-08-05T00:00:00.000Z");

const READ_OFF_THE_SITE: BusinessFact = {
  kind: "who_counts",
  statement: "People arriving from a search for a specific product.",
  provenance: {
    source: "site",
    at: AT,
    citation: "https://example.com/about",
    seen: null,
    statedBy: null,
  },
  correctedFrom: null,
  audience: null,
  confirmation: null,
};

const OBSERVED: BusinessFact = {
  kind: "who_counts",
  statement: "Most people who finish setup are working alone, not on a team.",
  provenance: {
    source: "sessions",
    at: AT,
    citation: null,
    seen: {
      sessions: 41,
      of: 60,
      from: new Date("2026-07-12T00:00:00.000Z"),
      to: new Date("2026-07-19T00:00:00.000Z"),
    },
    statedBy: null,
  },
  correctedFrom: null,
  audience: null,
  confirmation: null,
};

const CORRECTED: BusinessFact = {
  kind: "who_counts",
  statement: "Solo founders, mostly.",
  provenance: { source: "stated_by_customer", at: AT, citation: null, seen: null, statedBy: null },
  correctedFrom: "People arriving from a search for a specific product.",
  audience: null,
  confirmation: null,
};

function contextOf(facts: readonly BusinessFact[]): BusinessContext {
  return { facts: [...facts], removed: [] };
}

function laneOf(kind: BusinessFact["kind"], facts: readonly BusinessFact[]) {
  const lanes = [...toBindingLanes(contextOf(facts)), ...toShapingLanes(contextOf(facts))];
  const lane = lanes.find((entry) => entry.kind === kind);
  if (lane === undefined) throw new Error(`the ${kind} lane is missing`);
  return lane;
}

describe("splitting business context into what is stated and what was observed", () => {
  test("puts a fact read off the site on the stated side and one read off sessions opposite it", () => {
    const lane = laneOf("who_counts", [READ_OFF_THE_SITE, OBSERVED]);

    expect(lane.stated.map((row) => row.statement)).toEqual([READ_OFF_THE_SITE.statement]);
    expect(lane.observed.map((row) => row.statement)).toEqual([OBSERVED.statement]);
  });

  // A person correcting their own copy is still the business's claim about itself. Only
  // sessions can answer the other lane, which is the whole point of having two.
  test("keeps a person's own correction on the stated side", () => {
    const lane = laneOf("who_counts", [CORRECTED]);

    expect(lane.stated.map((row) => row.correctedFrom)).toEqual([CORRECTED.correctedFrom]);
    expect(lane.observed).toEqual([]);
  });

  test("cites an observation by its count and its denominator, never by a page", () => {
    const lane = laneOf("who_counts", [OBSERVED]);

    expect(lane.observed[0]?.evidence).toBe("Seen in 41 of 60 sessions, 12 Jul to 19 Jul");
  });

  test("shows no evidence line for an observation whose window is missing", () => {
    const lane = laneOf("who_counts", [
      { ...OBSERVED, provenance: { ...OBSERVED.provenance, seen: null } },
    ]);

    expect(lane.observed[0]?.evidence).toBe(null);
  });

  test("asks all seven binding questions even when only one of them has been answered", () => {
    expect(toBindingLanes(contextOf([READ_OFF_THE_SITE])).map((lane) => lane.kind)).toEqual([
      "regime",
      "forbidden_move",
      "load_bearing_friction",
      "conversion",
      "conversion_disqualifier",
      "invalidating_period",
      "who_counts",
    ]);
  });

  test("keeps the five shaping questions out of the binding section", () => {
    expect(toShapingLanes(contextOf([])).map((lane) => lane.kind)).toEqual([
      "decision_cadence",
      "stake_and_reversibility",
      "arrives_expecting",
      "catalogue_scale",
      "staleness_tolerance",
    ]);
  });

  // A "we see" lane under a licence would be waiting for a day that cannot come, and the
  // settings page reads this flag rather than rendering one anyway.
  test("marks a lane behaviour can never answer as unobservable", () => {
    expect(laneOf("regime", []).observable).toBe(false);
    expect(laneOf("who_counts", []).observable).toBe(true);
  });

  test("marks a lane no crawl proposes as stated-only, so the page offers adding to it", () => {
    expect(laneOf("conversion", []).statedOnly).toBe(true);
    expect(laneOf("regime", []).statedOnly).toBe(false);
  });

  test("reads a lane whose only rows came from sessions as worth showing", () => {
    expect(hasAnyFact(toBindingLanes(contextOf([OBSERVED])))).toBe(true);
  });

  test("reads no facts at all as nothing to show", () => {
    expect(hasAnyFact(toBindingLanes(contextOf([])))).toBe(false);
  });
});
