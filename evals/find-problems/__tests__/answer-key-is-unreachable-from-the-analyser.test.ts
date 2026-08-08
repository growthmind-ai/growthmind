import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { analyseCorpus, buildAnalyserPrompt, renderCorpus } from "../src/analyse/analyse";
import { corpusAnalysisInputSchema } from "../src/analyse/types";
import { loadScenario } from "../src/scenario/load";
import { ANSWER_KEY_FILE, loadAnswerKey } from "../src/score/answer-key";

const SCENARIO_DIR = join(import.meta.dir, "..", "src", "scenarios", "activation-from-sign-in");
const ANALYSE_DIR = join(import.meta.dir, "..", "src", "analyse");

function sourceOf(file: string): string {
  return readFileSync(join(ANALYSE_DIR, file), "utf8");
}

const CORPUS = {
  scenarioId: "activation-from-sign-in",
  startUrl: "http://localhost:3000/sign-in",
  sessionsTotal: 1,
  sessions: [
    {
      sessionId: "s-one",
      outcome: "gave_up" as const,
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
};

describe("the answer key never reaches the analyser", () => {
  it("keeps the key out of every module the analyser is built from", () => {
    for (const file of ["analyse.ts", "types.ts", "support.ts"]) {
      const source = sourceOf(file);
      expect(source).not.toContain(ANSWER_KEY_FILE);
      expect(source).not.toContain("answer-key");
      expect(source).not.toContain("answerKey");
      expect(source).not.toContain("loadAnswerKey");
    }
  });

  it("rejects an input carrying the key rather than passing it to a prompt", async () => {
    const smuggled = { ...CORPUS, answers: loadAnswerKey(SCENARIO_DIR) };

    expect(corpusAnalysisInputSchema.safeParse(smuggled).success).toBe(false);
    await expect(analyseCorpus({} as never, smuggled as never as typeof CORPUS)).rejects.toThrow();
  });

  it("keeps the key out of the scenario the run loads", () => {
    const scenario = loadScenario(SCENARIO_DIR);

    expect(Object.keys(scenario)).not.toContain("answers");
    expect(JSON.stringify(scenario)).not.toContain("observedIn");
    expect(JSON.stringify(scenario)).not.toContain("matchAny");
  });

  it("keeps every key title out of the prompt the analyser is sent", () => {
    const corpus = corpusAnalysisInputSchema.parse(CORPUS);
    const prompt = buildAnalyserPrompt(corpus);
    const rendered = renderCorpus(corpus);

    for (const problem of loadAnswerKey(SCENARIO_DIR).problems) {
      expect(prompt).not.toContain(problem.title);
      expect(prompt).not.toContain(problem.statement);
      expect(rendered).not.toContain(problem.title);
    }
  });
});
