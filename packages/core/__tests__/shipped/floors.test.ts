import { describe, expect, test } from "bun:test";

import { buildAtPageCorpus } from "../../src/shipped/corpus";
import { shippedCounts } from "../../src/shipped/counts";
import {
  SHIPPED_RECORDED_ELIGIBILITY_FLOOR,
  SHIPPED_SPINE_ELIGIBILITY_FLOOR,
  eligibilityFloorFor,
  shippedClaimGate,
} from "../../src/shipped/floors";
import { atPageInput, mustBuild, shippedCorpus } from "./fixtures";

function pageCorpusOf(atPage: number) {
  return mustBuild(
    buildAtPageCorpus(atPageInput(shippedCorpus({ totalSessions: 200, atPage }), { kind: "page" })),
  );
}

function recordedCorpusOf(recorded: number, touched: number) {
  const corpus = shippedCorpus({
    totalSessions: 200,
    atPage: 100,
    recordedAtPage: recorded,
    touchedAtPage: touched,
  });

  return mustBuild(buildAtPageCorpus(atPageInput(corpus, { kind: "recorded" })));
}

describe("the two ratified floors, and nothing else", () => {
  test("should hold the two floors Tom chose and no third magnitude", () => {
    expect(SHIPPED_SPINE_ELIGIBILITY_FLOOR).toBe(30);
    expect(SHIPPED_RECORDED_ELIGIBILITY_FLOOR).toBe(10);
  });

  test("should pick the spine floor for a page claim and the recorded floor for a control claim", () => {
    expect(eligibilityFloorFor("page")).toBe(SHIPPED_SPINE_ELIGIBILITY_FLOOR);
    expect(eligibilityFloorFor("recorded")).toBe(SHIPPED_RECORDED_ELIGIBILITY_FLOOR);
  });
});

describe("a page-level claim refuses below thirty eligible sessions", () => {
  test("should refuse at twenty-nine with no used or not-used statement", () => {
    const built = pageCorpusOf(29);

    expect(built.basis.kept).toBe(29);
    expect(shippedClaimGate(built)).toEqual({ kind: "too_few", denominator: 29 });
  });

  test("should claim at exactly thirty", () => {
    const built = pageCorpusOf(30);

    expect(built.basis.kept).toBe(30);
    expect(shippedClaimGate(built)).toEqual({ kind: "claim" });
  });
});

describe("a control-level claim refuses below ten recorded sessions", () => {
  test("should refuse at nine with no used or not-used statement", () => {
    const built = recordedCorpusOf(9, 4);

    expect(built.basis.kept).toBe(9);
    expect(shippedClaimGate(built)).toEqual({ kind: "too_few", denominator: 9 });
  });

  test("should claim at exactly ten", () => {
    const built = recordedCorpusOf(10, 4);

    expect(built.basis.kept).toBe(10);
    expect(shippedClaimGate(built)).toEqual({ kind: "claim" });
  });

  test("should not apply the page floor to a control claim", () => {
    // Ten recorded sessions is above its own floor and below the spine's, so a gate reading the
    // wrong floor refuses here.
    expect(SHIPPED_RECORDED_ELIGIBILITY_FLOOR).toBeLessThan(SHIPPED_SPINE_ELIGIBILITY_FLOOR);
    expect(shippedClaimGate(recordedCorpusOf(10, 4))).toEqual({ kind: "claim" });
  });
});

describe("a floor gates whether a claim is made, never whether the number is good", () => {
  test("should compare a floor against the denominator and never the numerator", () => {
    const built = recordedCorpusOf(40, 2);
    const counts = shippedCounts(built);

    // The numerator is below both ratified floors and the denominator is above both, so a floor
    // read off the numerator turns this claim into a refusal.
    expect(counts.reach.denominator).toBe(40);
    expect(counts.reach.numerator).toBe(2);
    expect(counts.reach.numerator).toBeLessThan(SHIPPED_RECORDED_ELIGIBILITY_FLOOR);

    expect(shippedClaimGate(built)).toEqual({ kind: "claim" });
  });

  test("should claim when nobody used it and enough people could have", () => {
    const built = recordedCorpusOf(40, 0);
    const counts = shippedCounts(built);

    expect(counts.reach.numerator).toBe(0);
    expect(shippedClaimGate(built)).toEqual({ kind: "claim" });
  });
});
