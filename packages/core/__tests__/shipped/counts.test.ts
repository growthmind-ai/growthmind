import { describe, expect, test } from "bun:test";

import type { CountBasis } from "../../src/counts/measured-count";
import type { AtPageCorpus } from "../../src/shipped/corpus";
import { buildAtPageCorpus } from "../../src/shipped/corpus";
import { shippedCounts } from "../../src/shipped/counts";
import {
  CONTROL_LABEL,
  SHIPPED_PAGE_HREF,
  SHIPPED_WINDOW,
  atPageInput,
  corpusOfSessions,
  mustBuild,
  shippedCorpus,
  shippedReplay,
  shippedSession,
} from "./fixtures";

function recordedCorpus(spec: {
  readonly atPage: number;
  readonly recorded: number;
  readonly touched: number;
  readonly identityGroups?: readonly (number | null)[];
}): AtPageCorpus {
  const corpus = shippedCorpus({
    totalSessions: 40,
    atPage: spec.atPage,
    recordedAtPage: spec.recorded,
    touchedAtPage: spec.touched,
    ...(spec.identityGroups === undefined ? {} : { identityGroups: spec.identityGroups }),
  });

  return mustBuild(buildAtPageCorpus(atPageInput(corpus, { kind: "recorded" })));
}

function pageCorpus(spec: {
  readonly atPage: number;
  readonly identityGroups?: readonly (number | null)[];
}): AtPageCorpus {
  const corpus = shippedCorpus({
    totalSessions: 40,
    atPage: spec.atPage,
    ...(spec.identityGroups === undefined ? {} : { identityGroups: spec.identityGroups }),
  });

  return mustBuild(buildAtPageCorpus(atPageInput(corpus, { kind: "page" })));
}

describe("reach counts the eligible sessions that touched the change", () => {
  test("should count reach over eligible sessions that touched the labelled control", () => {
    const built = recordedCorpus({ atPage: 20, recorded: 12, touched: 5 });
    const counts = shippedCounts(built);

    expect(counts.reach.numerator).toBe(5);
    expect(counts.reach.denominator).toBe(built.basis.kept);
    expect(counts.reach.denominator).toBe(12);
    expect(counts.reach.unit).toBe("sessions");
  });

  test("should count nobody as touching a control no recording names", () => {
    const corpus = corpusOfSessions({
      sessions: [
        shippedSession({ id: "rec-0", atPage: true, whoCountsUnchecked: false, identityGroup: 0 }),
        shippedSession({ id: "rec-1", atPage: true, whoCountsUnchecked: false, identityGroup: 1 }),
      ],
      replays: [
        shippedReplay({ sessionId: "rec-0", touched: true, controlLabel: "Download report" }),
        shippedReplay({ sessionId: "rec-1", touched: true, controlLabel: "Download report" }),
      ],
    });

    const counts = shippedCounts(
      mustBuild(buildAtPageCorpus(atPageInput(corpus, { kind: "recorded" }))),
    );

    expect(CONTROL_LABEL).not.toBe("Download report");
    expect(counts.reach.denominator).toBe(2);
    expect(counts.reach.numerator).toBe(0);
  });
});

describe("repeat counts people, and never sessions", () => {
  test("should count repeat over people and never over sessions", () => {
    // Seven eligible sessions across three people. Cycling [0,1,2] over indices 0..6 puts person
    // 0 on sessions 0, 3 and 6; person 1 on 1 and 4; person 2 on 2 and 5. The first five sessions
    // touched the change, so persons 0 and 1 came back to it and person 2 did not.
    const built = recordedCorpus({
      atPage: 7,
      recorded: 7,
      touched: 5,
      identityGroups: [0, 1, 2],
    });
    const counts = shippedCounts(built);

    expect(counts.reach.denominator).toBe(7);
    expect(counts.reach.numerator).toBe(5);

    const repeat = counts.repeat;
    if (repeat === null) throw new Error("three identified people must yield a repeat count");

    expect(repeat.numerator).toBe(2);
    expect(repeat.numerator).not.toBe(4);
    expect(repeat.numerator).not.toBe(7);
    expect(repeat.unit).toBe("people");
    expect(repeat.denominator).toBe(3);
  });

  test("should exclude unidentified sessions from both sides of repeat and state them separately", () => {
    // Cycling [0,1,2,null,null] over ten at-page sessions identifies six of them as three people
    // and leaves four nobody can be told apart between visits.
    const built = pageCorpus({ atPage: 10, identityGroups: [0, 1, 2, null, null] });
    const counts = shippedCounts(built);

    expect(built.basis.kept).toBe(10);
    expect(built.unidentifiedEligible).toBe(4);

    const repeat = counts.repeat;
    if (repeat === null) throw new Error("six identified sessions must yield a repeat count");

    expect(repeat.basis.totalInWindow).toBe(3);
    expect(repeat.denominator).toBe(3);
    expect(built.peopleBasis?.totalInWindow).toBe(3);
  });

  test("should leave keptUnchecked meaning who_counts and never reuse it for identity", () => {
    const built = pageCorpus({ atPage: 8, identityGroups: [0, 1, null, null] });

    expect(built.unidentifiedEligible).toBe(4);
    expect(built.basis.keptUnchecked).toBe(0);
    expect(built.peopleBasis?.keptUnchecked).toBe(0);
  });
});

describe("AC-G10 — repeat refuses at the zero identity boundary, not at a ratio", () => {
  test("should render repeat as no_rate with no_identity_coverage at the zero identity boundary", () => {
    const built = pageCorpus({ atPage: 12, identityGroups: [null] });
    const counts = shippedCounts(built);

    // The trigger is the zero boundary and nothing else: the denominator is not zero, so
    // zero_denominator cannot be the reason, and no coverage ratio was consulted to get here.
    expect(counts.reach.denominator).toBe(12);
    expect(counts.reach.denominator).toBeGreaterThan(0);
    expect(built.unidentifiedEligible).toBe(12);
    expect(built.peopleBasis).toBeNull();

    expect(counts.repeatRate).toEqual({ kind: "no_rate", reason: "no_identity_coverage" });
    expect(counts.repeat).toBeNull();
  });

  test("should render repeat as a rate the moment one eligible session carries an identity", () => {
    const built = pageCorpus({ atPage: 12, identityGroups: [0, null, null, null] });
    const counts = shippedCounts(built);

    expect(built.unidentifiedEligible).toBe(9);
    expect(counts.repeatRate.kind).toBe("rate");
  });
});

describe("AC-G7 — both halves of a claim come from the same corpus", () => {
  test("should make a spine denominator under a replay numerator unconstructable", () => {
    const basis: CountBasis = { totalInWindow: 4, kept: 4, setAside: [], keptUnchecked: 0 };

    const lookalike = {
      kind: "recorded",
      basis,
      peopleBasis: null,
      timeframe: SHIPPED_WINDOW,
      truncated: false,
      touchedSessions: 2,
      repeatPeople: 0,
      unidentifiedEligible: 0,
    };

    // @ts-expect-error —: the AT_PAGE brand is module-private, so no literal is an AtPageCorpus
    // and buildAtPageCorpus is the only way to pair a numerator with a denominator.
    const unbranded: AtPageCorpus = lookalike;
    expect(unbranded.basis.kept).toBe(4);

    // The runtime half: a session with no recording is refused entry to a control-level corpus,
    // so a replay numerator can never be laid over a denominator drawn from the spine.
    const corpus = corpusOfSessions({
      sessions: [
        shippedSession({ id: "rec-0", atPage: true, whoCountsUnchecked: false, identityGroup: 0 }),
        shippedSession({
          id: "unrecorded",
          atPage: true,
          whoCountsUnchecked: false,
          identityGroup: 1,
        }),
      ],
      replays: [shippedReplay({ sessionId: "rec-0", touched: true })],
    });

    const recorded = mustBuild(buildAtPageCorpus(atPageInput(corpus, { kind: "recorded" })));
    const spine = mustBuild(buildAtPageCorpus(atPageInput(corpus, { kind: "page" })));

    expect(spine.basis.kept).toBe(2);
    expect(recorded.basis.kept).toBe(1);
    expect(shippedCounts(recorded).reach.denominator).toBe(1);
  });

  test("should derive a recorded denominator strictly smaller than the at-page spine denominator", () => {
    const corpus = shippedCorpus({
      totalSessions: 60,
      atPage: 20,
      recordedAtPage: 8,
      touchedAtPage: 3,
      recordedPages: [SHIPPED_PAGE_HREF],
    });

    const spine = shippedCounts(
      mustBuild(buildAtPageCorpus(atPageInput(corpus, { kind: "page" }))),
    );
    const recorded = shippedCounts(
      mustBuild(buildAtPageCorpus(atPageInput(corpus, { kind: "recorded" }))),
    );

    expect(spine.reach.denominator).toBe(20);
    expect(recorded.reach.denominator).toBe(8);
    expect(recorded.reach.denominator).toBeLessThan(spine.reach.denominator);

    // The wrong arithmetic this outcome must not ship, written out so the assertion above cannot
    // be read as arbitrary: the replay numerator over the spine denominator.
    expect(recorded.reach.numerator).toBe(3);
    expect(recorded.reach.denominator).not.toBe(spine.reach.denominator);
  });
});
