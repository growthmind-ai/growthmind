import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { buildAnalyserPrompt } from "../src/analyse/analyse";
import { corpusAnalysisInputSchema } from "../src/analyse/types";
import { buildCorpusFacts } from "../src/facts/build";
import { ANSWER_KEY_FILE, loadAnswerKey } from "../src/score/answer-key";

const FACTS_DIR = join(import.meta.dir, "..", "src", "facts");
const SCENARIO_DIR = join(import.meta.dir, "..", "src", "scenarios", "activation-from-sign-in");

const CORPUS = corpusAnalysisInputSchema.parse({
  scenarioId: "activation-from-sign-in",
  startUrl: "http://localhost:3000/sign-in",
  sessionsTotal: 1,
  sessions: [
    {
      sessionId: "s-one",
      outcome: "gave_up",
      pages: ["http://localhost:3000/sign-in"],
      urlTrail: ["http://localhost:3000/sign-in"],
      durationMs: 1000,
      counts: {
        clicks: 1,
        deadClicks: 0,
        rageClicks: 0,
        refocuses: 0,
        abandonedFields: 0,
        scrollBacks: 0,
      },
      beats: [{ index: 1, line: "0:00  opened http://localhost:3000/sign-in" }],
      consoleErrorCount: 0,
      consoleErrors: [],
      exitReason: null,
    },
  ],
});

describe("the facts are counted from the corpus and never read from the key", () => {
  it("keeps the key out of every module the fact builder is made of", () => {
    for (const file of readdirSync(FACTS_DIR)) {
      const source = readFileSync(join(FACTS_DIR, file), "utf8");

      expect(source).not.toContain(ANSWER_KEY_FILE);
      expect(source).not.toContain("answer-key");
      expect(source).not.toContain("answerKey");
      expect(source).not.toContain("loadAnswerKey");
      expect(source).not.toContain("scenarios");
    }
  });

  it("keeps every key title and statement out of the facts and the prompt they go into", () => {
    const facts = buildCorpusFacts(CORPUS);
    const rendered = JSON.stringify(facts);
    const prompt = buildAnalyserPrompt(CORPUS, facts);

    for (const problem of loadAnswerKey(SCENARIO_DIR).problems) {
      expect(rendered).not.toContain(problem.title);
      expect(rendered).not.toContain(problem.statement);
      expect(prompt).not.toContain(problem.title);
      expect(prompt).not.toContain(problem.statement);
    }
  });

  it("counts the same corpus the same way twice, so a fact is reproducible", () => {
    expect(buildCorpusFacts(CORPUS)).toEqual(buildCorpusFacts(CORPUS));
  });
});
