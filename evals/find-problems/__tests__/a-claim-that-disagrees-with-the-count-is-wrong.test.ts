import { describe, expect, it } from "bun:test";

import type { AssessedProblem } from "../src/analyse/types";
import type { CorpusFact, CorpusFacts } from "../src/facts/types";
import { findContradictions, leadDeterministically } from "../src/score/facts";
import { scoreCorpus } from "../src/score/score";
import type { AnswerKey } from "../src/scenario/types";

const HEADLINE: CorpusFact = {
  id: "connected",
  statement: "0 of 4 sessions connected anything",
  count: 0,
  of: 4,
  sessionIds: [],
  subjectSignals: ["connected anything", "sessions connected"],
};

const REACHED_SETUP: CorpusFact = {
  id: "reached:/first-run",
  statement: "3 of 4 sessions reached /first-run",
  count: 3,
  of: 4,
  sessionIds: ["s-a", "s-b", "s-c"],
  subjectSignals: ["reached /first-run"],
};

const FACTS: CorpusFacts = {
  definitionOfActivation: "the screen said a connection was made",
  headline: HEADLINE,
  facts: [HEADLINE, REACHED_SETUP],
};

const KEY: AnswerKey = {
  scenarioId: "test",
  derivedFromRun: "test",
  problems: [
    {
      id: "A1",
      title: "Nobody connected anything",
      statement: "No session got that far.",
      observedIn: ["all sessions"],
      matchAny: ["no session connected anything"],
      severity: "high",
    },
  ],
};

function proposal(overrides: Partial<AssessedProblem>): AssessedProblem {
  return {
    id: "P1",
    title: "Nobody got the product connected",
    whatWasSeen: "4 of 4 sessions ended without having connected anything.",
    sessionsAffected: 4,
    citations: [],
    recommendation: { action: "Shorten the setup", whereInProduct: "/first-run", whyItHelps: "" },
    support: "cited",
    validCitations: 1,
    invalidCitations: 0,
    sessionsTotal: 4,
    claimedMoreThanCorpus: false,
    ...overrides,
  };
}

describe("a claim may not disagree with a count the harness made", () => {
  it("accepts the count itself and accepts its complement", () => {
    expect(findContradictions(FACTS, [proposal({})])).toEqual([]);
    expect(
      findContradictions(FACTS, [
        proposal({ whatWasSeen: "0 of 4 sessions connected anything.", sessionsAffected: 0 }),
      ]),
    ).toEqual([]);
  });

  it("marks a claim that states any other number for something already counted", () => {
    const rows = findContradictions(FACTS, [
      proposal({ whatWasSeen: "2 of 4 sessions connected anything.", sessionsAffected: 2 }),
    ]);

    expect(rows.length).toBe(1);
    expect(rows[0]?.factId).toBe("connected");
    expect(rows[0]?.factStatement).toBe(HEADLINE.statement);
  });

  it("reads a number written as a word, which is how the model tends to write it", () => {
    const rows = findContradictions(FACTS, [
      proposal({
        title: "The setup page",
        whatWasSeen: "two sessions reached /first-run and stopped.",
        sessionsAffected: 2,
      }),
    ]);

    expect(rows.map((row) => row.factId)).toEqual(["reached:/first-run"]);
  });

  it("leaves a claim about something the harness did not count alone", () => {
    const rows = findContradictions(FACTS, [
      proposal({ title: "The sign-up form", whatWasSeen: "1 of 4 sessions retyped everything." }),
    ]);

    expect(rows).toEqual([]);
  });
});

describe("leading with the corpus's headline fact is scored", () => {
  it("counts the opening problem as leading when it is the one the headline names", () => {
    const verdict = leadDeterministically(FACTS, [proposal({}), proposal({ id: "P2" })]);

    expect(verdict?.led).toBe(true);
    expect(verdict?.proposalId).toBe("P1");
    expect(verdict?.method).toBe("matched");
  });

  it("counts it as not leading when the headline turns up further down the list", () => {
    const buried = [
      proposal({ id: "P1", title: "Slow page", whatWasSeen: "1 of 4 sessions waited." }),
      proposal({ id: "P2" }),
    ];

    expect(leadDeterministically(FACTS, buried)?.led).toBe(false);
    expect(leadDeterministically(FACTS, buried)?.proposalId).toBe("P2");
  });

  it("hands the row to the judge only when no proposal is recognisably about the fact", () => {
    const unrelated = [proposal({ title: "Slow page", whatWasSeen: "1 of 4 sessions waited." })];

    expect(leadDeterministically(FACTS, unrelated)).toBeNull();
  });

  it("says nobody led when nothing was proposed at all", () => {
    expect(leadDeterministically(FACTS, [])?.led).toBe(false);
  });

  it("reports the row on the scorecard beside the rest", () => {
    const proposals = [proposal({})];
    const card = scoreCorpus({
      key: KEY,
      proposals,
      matchVerdicts: [],
      recommendationVerdicts: [],
      facts: FACTS,
      lead: leadDeterministically(FACTS, proposals) ?? {
        led: false,
        proposalId: null,
        method: "judged",
        note: null,
      },
    });

    expect(card.headlineFact).toBe(HEADLINE.statement);
    expect(card.ledWithHeadlineFact).toBe(true);
    expect(card.leadProposalId).toBe("P1");
    expect(card.claimsContradictingAFact).toEqual([]);
  });
});
