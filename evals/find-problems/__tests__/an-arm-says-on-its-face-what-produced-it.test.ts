import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { analyserSystemPrompt, buildAnalyserPrompt, renderFacts } from "../src/analyse/analyse";
import { corpusAnalysisInputSchema } from "../src/analyse/types";
import { buildCorpusFacts } from "../src/facts/build";
import { renderReport } from "../src/report";
import { describeConditions, type AnalysisConditions } from "../src/run-manifest";
import type { AnswerKey } from "../src/scenario/types";
import { scoreCorpus } from "../src/score/score";

const BASELINE_RUN = join(import.meta.dir, "..", "runs", "corpus-3");

const CORPUS = corpusAnalysisInputSchema.parse({
  scenarioId: "activation-from-sign-in",
  startUrl: "http://localhost:3000/sign-in",
  sessionsTotal: 2,
  sessions: [
    {
      sessionId: "s-one",
      outcome: "gave_up",
      pages: [],
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
    {
      sessionId: "s-two",
      outcome: "step_cap",
      pages: [],
      urlTrail: ["http://localhost:3000/sign-in", "http://localhost:3000/first-run"],
      durationMs: 2000,
      counts: {
        clicks: 2,
        deadClicks: 0,
        rageClicks: 0,
        refocuses: 0,
        abandonedFields: 0,
        scrollBacks: 0,
      },
      beats: [{ index: 1, line: `0:10  saw "We could not read what you sent."` }],
      consoleErrorCount: 0,
      consoleErrors: [],
      exitReason: null,
    },
  ],
});

const FACTS = buildCorpusFacts(CORPUS);

const KEY: AnswerKey = {
  scenarioId: "activation-from-sign-in",
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

function reportWith(conditions: AnalysisConditions | undefined): string {
  return renderReport({
    runId: "test",
    scenarioTitle: "test",
    modelIds: {},
    sessionLines: [],
    problems: [],
    facts: FACTS,
    scorecard: scoreCorpus({
      key: KEY,
      proposals: [],
      matchVerdicts: [],
      recommendationVerdicts: [],
      facts: FACTS,
      lead: { led: false, proposalId: null, method: "matched", note: null },
    }),
    conditions,
  });
}

describe("withholding the counts moves the prompt and nothing else", () => {
  it("puts no count, no headline and no definition in front of the analyser", () => {
    const withheld = buildAnalyserPrompt(CORPUS, null);

    for (const fact of FACTS.facts) expect(withheld).not.toContain(fact.statement);
    expect(withheld).not.toContain(FACTS.definitionOfActivation);
    expect(withheld).not.toContain(renderFacts(FACTS));
    expect(buildAnalyserPrompt(CORPUS, FACTS)).toContain(FACTS.headline.statement);
  });

  it("still shows the analyser the same sessions, so only the counts are the variable", () => {
    const withheld = buildAnalyserPrompt(CORPUS, null);

    for (const session of CORPUS.sessions) expect(withheld).toContain(session.sessionId);
    expect(withheld).toContain("0:10  saw");
  });

  it("drops only the line about the counts from the analyser's instructions", () => {
    const given = analyserSystemPrompt(true).split("\n");
    const withheld = analyserSystemPrompt(false).split("\n");

    expect(given.length - withheld.length).toBe(1);
    for (const line of withheld) expect(given).toContain(line);
  });

  it.skipIf(!existsSync(join(BASELINE_RUN, "analysis.json")))(
    "reproduces word for word the prompt the run before the counts was sent",
    () => {
      const baseline = JSON.parse(readFileSync(join(BASELINE_RUN, "analysis.json"), "utf8")) as {
        readonly prompt: string;
      };
      const corpus = corpusAnalysisInputSchema.parse(
        JSON.parse(readFileSync(join(BASELINE_RUN, "corpus.json"), "utf8")),
      );

      expect(buildAnalyserPrompt(corpus, null)).toBe(baseline.prompt);
    },
  );
});

describe("a report says on its face which arm produced it", () => {
  it("leads with the conditions, above the scorecard anyone would quote", () => {
    const conditions: AnalysisConditions = {
      countsGiven: false,
      exitReasonsShown: false,
      recordingsFrom: "corpus-3",
      analysedAt: "2026-08-08T00:00:00.000Z",
    };
    const report = reportWith(conditions);

    expect(report.split("\n")[2]).toContain("**Conditions.**");
    expect(report).toContain("withheld from the analyser");
    expect(report).toContain("rebuilt from corpus-3's recordings");
    expect(report.indexOf("Conditions.")).toBeLessThan(report.indexOf("## Scorecard"));
  });

  it("says the counts were given when they were", () => {
    const report = reportWith({
      countsGiven: true,
      exitReasonsShown: false,
      recordingsFrom: null,
      analysedAt: "2026-08-08T00:00:00.000Z",
    });

    expect(report).toContain("was given the counts");
    expect(report).toContain("this run's own recordings");
    expect(report).not.toContain("withheld");
  });

  it("admits it does not know rather than implying an arm, on a run recorded before arms were", () => {
    expect(describeConditions(undefined)).toContain("not recorded");
    expect(reportWith(undefined)).toContain("not recorded");
  });
});
