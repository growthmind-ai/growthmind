import { describe, expect, it } from "bun:test";

import { join } from "node:path";

import type { AssessedProblem } from "../src/analyse/types";
import { answerKeySchema, keyProblemSchema, type AnswerKey } from "../src/scenario/types";
import { loadAnswerKey } from "../src/score/answer-key";
import { matchDeterministically } from "../src/score/match";
import { scoreCorpus } from "../src/score/score";

const KEY: AnswerKey = {
  scenarioId: "test",
  derivedFromRun: "test",
  problems: [
    {
      id: "A1",
      title: "People sign in before they have an account",
      statement: "They all try the sign-in form first.",
      observedIn: ["s-one beat 2"],
      matchAny: ["sign in before signing up"],
      severity: "high",
    },
    {
      id: "A2",
      title: "Nobody reaches the setup step",
      statement: "No session gets that far.",
      observedIn: ["all sessions"],
      matchAny: ["no session reached setup"],
      severity: "medium",
    },
  ],
};

function proposal(overrides: Partial<AssessedProblem>): AssessedProblem {
  return {
    id: "P1",
    title: "People sign in before they have an account",
    whatWasSeen: "Every session tries to sign in before signing up.",
    sessionsAffected: 2,
    citations: [{ sessionId: "s-one", beat: 2, quote: "clicked Sign in" }],
    recommendation: { action: "Lead with sign-up", whereInProduct: "/sign-in", whyItHelps: "" },
    support: "cited",
    validCitations: 1,
    invalidCitations: 0,
    sessionsTotal: 2,
    claimedMoreThanCorpus: false,
    ...overrides,
  };
}

describe("the key's match signals must be able to discriminate", () => {
  const problem = { ...KEY.problems[0]!, matchAny: ["posthog"] };

  it("refuses a one-word signal, which would score any mention of the screen as a hit", () => {
    expect(keyProblemSchema.safeParse(problem).success).toBe(false);
    expect(answerKeySchema.safeParse({ ...KEY, problems: [problem] }).success).toBe(false);
  });

  it("accepts the phrases the real key ships with", () => {
    const key = loadAnswerKey(
      join(import.meta.dir, "..", "src", "scenarios", "activation-from-sign-in"),
    );

    for (const entry of key.problems) {
      expect(entry.matchAny.length).toBeGreaterThan(0);
      expect(entry.observedIn.length).toBeGreaterThan(0);
    }
  });
});

describe("scoring a corpus against the key", () => {
  it("counts a planted problem nobody proposed as missed, with its denominator intact", () => {
    const proposals = [proposal({})];
    const deterministic = matchDeterministically(KEY, proposals);

    const card = scoreCorpus({
      key: KEY,
      proposals,
      matchVerdicts: deterministic.verdicts,
      recommendationVerdicts: [],
    });

    expect(card.keyTotal).toBe(2);
    expect(card.found.map((row) => row.keyProblemId)).toEqual(["A1"]);
    expect(card.missed.map((row) => row.keyProblemId)).toEqual(["A2"]);
    expect(card.found.length + card.missed.length).toBe(card.keyTotal);
  });

  it("counts every planted problem as missed when the analyser proposed nothing", () => {
    const card = scoreCorpus({
      key: KEY,
      proposals: [],
      matchVerdicts: [],
      recommendationVerdicts: [],
    });

    expect(card.found).toEqual([]);
    expect(card.missed.length).toBe(2);
    expect(card.proposalsTotal).toBe(0);
  });

  it("does not count a key problem as found when the judge returned no proposal for it", () => {
    const proposals = [proposal({ title: "Something else entirely", id: "P9" })];

    const card = scoreCorpus({
      key: KEY,
      proposals,
      matchVerdicts: [{ keyProblemId: "A2", proposalId: null, method: "judged", note: "no match" }],
      recommendationVerdicts: [],
    });

    expect(card.found).toEqual([]);
    expect(card.missed.map((row) => row.keyProblemId)).toEqual(["A1", "A2"]);
  });

  it("separates a proposal beyond the key from one it invented", () => {
    const proposals = [
      proposal({ id: "P1", title: "Beyond the key", support: "cited", validCitations: 1 }),
      proposal({ id: "P2", title: "Made up", support: "unsupported", validCitations: 0 }),
    ];

    const card = scoreCorpus({
      key: KEY,
      proposals,
      matchVerdicts: [],
      recommendationVerdicts: [],
    });

    expect(card.beyondTheKey.map((row) => row.proposalId)).toEqual(["P1"]);
    expect(card.invented.map((row) => row.proposalId)).toEqual(["P2"]);
  });

  it("reports how many found rows a string settled and how many needed the judge", () => {
    const proposals = [
      proposal({}),
      proposal({ id: "P2", title: "Nobody reaches the setup step" }),
    ];
    const deterministic = matchDeterministically(KEY, proposals);

    const card = scoreCorpus({
      key: KEY,
      proposals,
      matchVerdicts: [
        ...deterministic.verdicts,
        { keyProblemId: "A2", proposalId: "P2", method: "judged", note: "same problem" },
      ],
      recommendationVerdicts: [],
    });

    expect(card.rowsMatched).toBe(1);
    expect(card.rowsJudged).toBe(1);
    expect(card.found.length).toBe(2);
  });
});
