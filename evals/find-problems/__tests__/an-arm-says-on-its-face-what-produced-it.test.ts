import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CORPUS_DELIMITER,
  analyserSystemPrompt,
  buildAnalyserPrompt,
  renderFacts,
} from "../src/analyse/analyse";
import { corpusAnalysisInputSchema } from "../src/analyse/types";
import { buildCorpusFacts } from "../src/facts/build";
import { renderReport } from "../src/report";
import { describeConditions, type AnalysisConditions } from "../src/run-manifest";
import type { AnswerKey } from "../src/scenario/types";
import { scoreCorpus } from "../src/score/score";

const BASELINE_RUN = join(import.meta.dir, "..", "runs", "corpus-3");

// Shaped like the real thing the recorder caught — base64url payload, JWT-ish — with obviously
// fake ids, so a public repo carries no signed token even an expired one.
const SIGNED_STATE =
  "eyJ2IjoxLCJ1IjoiRkFLRVVTRVJJRE5PVFJFQUwiLCJvIjoib3JnLTAwMDAwMDAwLTAwMDAtMDAwMC0wMDAwLTAwMDAwMDAwMDAwMCJ9.ZmFrZXNpZ25hdHVyZQ";

/** The corpus half of a prompt: what the analyser was shown, with the counts block excluded. */
function sessionsIn(prompt: string): string {
  const parts = prompt.split(CORPUS_DELIMITER);
  return parts[parts.length - 2] ?? "";
}

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

  // Anchored on the invariant rather than on a stored prompt. The stored one was retired when
  // the URL trail started being labelled — a signed token with our own org id was reaching the
  // analyser through it — and a frozen string cannot tell a security fix from a drifting prompt.
  it.skipIf(!existsSync(join(BASELINE_RUN, "corpus.json")))(
    "shows both arms byte-identical sessions, so only the counts are the variable",
    () => {
      const corpus = corpusAnalysisInputSchema.parse(
        JSON.parse(readFileSync(join(BASELINE_RUN, "corpus.json"), "utf8")),
      );

      const withheld = buildAnalyserPrompt(corpus, null);
      const given = buildAnalyserPrompt(corpus, buildCorpusFacts(corpus));

      expect(sessionsIn(withheld)).toBe(sessionsIn(given));
      expect(sessionsIn(withheld).length).toBeGreaterThan(0);
    },
  );

  // Inline, never read from runs/ — that directory is gitignored, so a fixture-backed version of
  // this skipped silently on a clean clone and reported green having asserted nothing about the
  // one thing it exists to prove.
  it("never puts a signed token in front of the analyser, whichever arm is running", () => {
    const corpus = corpusAnalysisInputSchema.parse({
      ...CORPUS,
      sessions: [
        {
          ...CORPUS.sessions[0],
          urlTrail: [
            "http://localhost:3000/first-run",
            `https://slack.com/workspace-signin?redir=%2Foauth%3Fstate%3D${SIGNED_STATE}%26scope%3Dchat%253Awrite`,
          ],
        },
        CORPUS.sessions[1],
      ],
    });

    for (const prompt of [
      buildAnalyserPrompt(corpus, null),
      buildAnalyserPrompt(corpus, buildCorpusFacts(corpus)),
    ]) {
      expect(prompt).not.toContain(SIGNED_STATE);
      expect(prompt).not.toContain("eyJ");
      expect(prompt).toContain("https://slack.com");
    }
  });
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
