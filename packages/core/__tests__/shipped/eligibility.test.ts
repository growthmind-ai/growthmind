import { URL_PATH_NORMALISATION_VERSION } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { measuredCount } from "../../src/counts/measured-count";
import { buildAtPageCorpus } from "../../src/shipped/corpus";
import { shippedCounts } from "../../src/shipped/counts";
import {
  CONTROL_LABEL,
  SHIPPED_PAGE,
  SHIPPED_PAGE_HREF,
  SHIPPED_WINDOW,
  atPageInput,
  corpusOfSessions,
  emptyReplay,
  mustBuild,
  shippedCorpus,
  shippedReplay,
  shippedSession,
} from "./fixtures";

function setAsideTotal(setAside: readonly { readonly count: number }[]): number {
  return setAside.reduce((sum, row) => sum + row.count, 0);
}

describe("the basis is rebuilt over the sessions that reached the page", () => {
  test("should rebuild totalInWindow kept and setAside over the at-page subset only", () => {
    const corpus = shippedCorpus({ totalSessions: 40, atPage: 18, excludedAtPage: 5 });
    const built = mustBuild(buildAtPageCorpus(atPageInput(corpus)));

    expect(built.basis.totalInWindow).toBe(18);
    expect(built.basis.kept).toBe(13);
    expect(setAsideTotal(built.basis.setAside)).toBe(5);
    expect(built.basis.kept + setAsideTotal(built.basis.setAside)).toBe(
      built.basis.totalInWindow,
    );
  });

  test("should carry the at-page set-aside reasons rather than the window's", () => {
    const corpus = shippedCorpus({
      totalSessions: 40,
      atPage: 18,
      excludedAtPage: 5,
      excludedAtPageReason: "internal_domain",
      excludedOffPage: 7,
      excludedOffPageReason: "automation_headless",
    });
    const built = mustBuild(buildAtPageCorpus(atPageInput(corpus)));

    expect(built.basis.setAside.map((row) => row.reason)).toEqual(["internal_domain"]);
    expect(setAsideTotal(built.basis.setAside)).toBe(5);
  });

  test("should compute keptUnchecked over the at-page kept set, not the window", () => {
    const corpus = shippedCorpus({
      totalSessions: 40,
      atPage: 18,
      excludedAtPage: 5,
      uncheckedAtPageKept: 3,
      uncheckedOffPageKept: 6,
    });

    expect(corpus.basis.keptUnchecked).toBe(9);

    const built = mustBuild(buildAtPageCorpus(atPageInput(corpus)));
    expect(built.basis.keptUnchecked).toBe(3);
  });

  test("should keep a MeasuredCount constructable from the rebuilt basis", () => {
    const corpus = shippedCorpus({ totalSessions: 40, atPage: 18, excludedAtPage: 5 });
    const built = mustBuild(buildAtPageCorpus(atPageInput(corpus)));

    expect(() =>
      measuredCount({
        numerator: 4,
        denominator: built.basis.kept,
        unit: "sessions",
        timeframe: SHIPPED_WINDOW,
        basis: built.basis,
      }),
    ).not.toThrow();
  });
});

describe("the readout refuses rather than guesses", () => {
  test("should refuse when a corpus predates the whoCountsUnchecked flag", () => {
    const corpus = shippedCorpus({
      totalSessions: 40,
      atPage: 18,
      carryWhoCountsFlag: false,
      keptUnchecked: 4,
    });

    expect(corpus.basis.keptUnchecked).toBe(4);
    expect(corpus.sessions.every((session) => session.whoCountsUnchecked === undefined)).toBe(true);

    expect(buildAtPageCorpus(atPageInput(corpus))).toEqual({
      ok: false,
      reason: "corpus_predates_who_counts",
    });
  });

  test("should refuse when the stored page normalisation version is stale", () => {
    const corpus = shippedCorpus({ totalSessions: 40, atPage: 18 });

    expect(URL_PATH_NORMALISATION_VERSION).not.toBe(2);

    expect(
      buildAtPageCorpus(atPageInput(corpus, { pageNormalisationVersion: 2 })),
    ).toEqual({ ok: false, reason: "stale_page_spelling" });
  });

  test("should build when the stored page normalisation version is current", () => {
    const corpus = shippedCorpus({ totalSessions: 40, atPage: 18 });

    expect(
      buildAtPageCorpus(
        atPageInput(corpus, { pageNormalisationVersion: URL_PATH_NORMALISATION_VERSION }),
      ).ok,
    ).toBe(true);
  });
});

describe("AC-G6 — the eligibility gate that can go red", () => {
  test("should derive a denominator strictly less than the window basis kept on a mixed corpus", () => {
    const corpus = shippedCorpus({
      totalSessions: 40,
      atPage: 18,
      excludedAtPage: 5,
      excludedOffPage: 3,
    });
    const built = mustBuild(buildAtPageCorpus(atPageInput(corpus)));
    const counts = shippedCounts(built);

    // The two candidate denominators, numerically different, so neither assertion can pass by
    // agreeing with the other.
    expect(built.basis.kept).toBe(13);
    expect(corpus.basis.kept).toBe(32);

    expect(counts.reach.denominator).toBe(built.basis.kept);
    expect(counts.reach.denominator).toBeLessThan(corpus.basis.kept);

    // The set-aside breakdown is exercised, not empty.
    expect(setAsideTotal(built.basis.setAside)).toBe(5);

    // The wrong answer — the whole window's kept count, which is what detectFunnelDropoff hands
    // over at funnel-dropoff.ts:24 — satisfies every invariant the count type enforces. That is
    // why `kept + Σ setAside === totalInWindow` is not the gate here.
    expect(() =>
      measuredCount({
        numerator: counts.reach.numerator,
        denominator: corpus.basis.kept,
        unit: "sessions",
        timeframe: SHIPPED_WINDOW,
        basis: corpus.basis,
      }),
    ).not.toThrow();
  });
});

describe("D10 — the declared fail direction is over-count eligibility", () => {
  test("FAIL_DIRECTION: should count an ambiguously-at-page session in the denominator and never in the numerator", () => {
    const certain = Array.from({ length: 10 }, (_, index) =>
      shippedSession({ id: `certain-${String(index)}`, atPage: true, whoCountsUnchecked: false }),
    );

    // The page is spelled the same, and the stamp that says which normaliser spelled it is
    // absent. We cannot prove this session reached the page, so it is eligible and untouched.
    const ambiguous = Array.from({ length: 2 }, (_, index) =>
      shippedSession({
        id: `ambiguous-${String(index)}`,
        atPage: true,
        whoCountsUnchecked: false,
        normalisationVersion: null,
      }),
    );

    const corpus = corpusOfSessions({ sessions: [...certain, ...ambiguous] });
    const counts = shippedCounts(mustBuild(buildAtPageCorpus(atPageInput(corpus))));

    expect(counts.reach.denominator).toBe(12);
    expect(counts.reach.numerator).toBe(10);
  });

  test("FAIL_DIRECTION: should count a recorded session whose control cannot be named in the denominator only", () => {
    const named = shippedSession({ id: "named", atPage: true, whoCountsUnchecked: false });
    const unnameable = shippedSession({ id: "unnameable", atPage: true, whoCountsUnchecked: false });

    const corpus = corpusOfSessions({
      sessions: [named, unnameable],
      replays: [
        shippedReplay({ sessionId: "named", touched: true }),
        shippedReplay({ sessionId: "unnameable", touchedUnlabelled: true }),
      ],
    });

    const counts = shippedCounts(
      mustBuild(buildAtPageCorpus(atPageInput(corpus, { kind: "recorded" }))),
    );

    expect(counts.reach.denominator).toBe(2);
    expect(counts.reach.numerator).toBe(1);
  });
});

describe("D5 — a recording that exists and one that never did are not the same absence", () => {
  test("should leave a session with no recording out of a control-level denominator", () => {
    const corpus = corpusOfSessions({
      sessions: [
        shippedSession({ id: "rec-0", atPage: true, whoCountsUnchecked: false }),
        shippedSession({ id: "rec-1", atPage: true, whoCountsUnchecked: false }),
        shippedSession({ id: "unrecorded", atPage: true, whoCountsUnchecked: false }),
      ],
      replays: [
        shippedReplay({ sessionId: "rec-0", touched: true }),
        emptyReplay("rec-1", [SHIPPED_PAGE_HREF]),
      ],
    });

    // All three reached the page on the spine; only two were recorded.
    expect(
      mustBuild(buildAtPageCorpus(atPageInput(corpus, { kind: "page" }))).basis.kept,
    ).toBe(3);

    const built = mustBuild(buildAtPageCorpus(atPageInput(corpus, { kind: "recorded" })));
    expect(built.basis.kept).toBe(2);
    expect(built.basis.totalInWindow).toBe(2);
  });

  test("should keep a recorded session that recorded no actions eligible and untouched", () => {
    const corpus = corpusOfSessions({
      sessions: [
        shippedSession({ id: "rec-0", atPage: true, whoCountsUnchecked: false }),
        shippedSession({ id: "rec-1", atPage: true, whoCountsUnchecked: false }),
      ],
      replays: [
        shippedReplay({ sessionId: "rec-0", touched: true, controlLabel: CONTROL_LABEL }),
        emptyReplay("rec-1", [SHIPPED_PAGE_HREF]),
      ],
    });

    const counts = shippedCounts(
      mustBuild(buildAtPageCorpus(atPageInput(corpus, { kind: "recorded" }))),
    );

    expect(counts.reach.denominator).toBe(2);
    expect(counts.reach.numerator).toBe(1);
  });
});

describe("the page a claim is built against is the one the change row named", () => {
  test("should count nobody at a page no session reached", () => {
    const corpus = shippedCorpus({ totalSessions: 40, atPage: 18 });
    const built = mustBuild(
      buildAtPageCorpus(atPageInput(corpus, { page: "/t053/never-shipped" })),
    );

    expect(built.basis.totalInWindow).toBe(0);
    expect(built.basis.kept).toBe(0);
    expect(SHIPPED_PAGE).not.toBe("/t053/never-shipped");
  });
});
