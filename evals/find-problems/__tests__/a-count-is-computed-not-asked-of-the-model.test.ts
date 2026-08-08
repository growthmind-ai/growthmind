import { describe, expect, it } from "bun:test";

import { ONBOARDING_MESSAGES } from "@growthmind/shared";

import { buildAnalyserPrompt } from "../src/analyse/analyse";
import { corpusAnalysisInputSchema, type SessionSummary } from "../src/analyse/types";
import { ACTIVATION_DEFINITION, hasConnectedSomething, literalOf } from "../src/facts/activation";
import { buildCorpusFacts, pageLabel } from "../src/facts/build";

const PRODUCT = "http://localhost:3000";

function session(overrides: Partial<SessionSummary>): SessionSummary {
  return {
    sessionId: "s-one",
    outcome: "step_cap",
    pages: [],
    urlTrail: [`${PRODUCT}/sign-in`],
    durationMs: 1000,
    counts: {
      clicks: 1,
      deadClicks: 0,
      rageClicks: 0,
      refocuses: 0,
      abandonedFields: 0,
      scrollBacks: 0,
    },
    beats: [{ index: 1, line: `0:00  opened ${PRODUCT}/sign-in` }],
    consoleErrorCount: 0,
    consoleErrors: [],
    exitReason: null,
    ...overrides,
  };
}

function corpus(sessions: readonly SessionSummary[]) {
  return corpusAnalysisInputSchema.parse({
    scenarioId: "test",
    startUrl: `${PRODUCT}/sign-in`,
    sessionsTotal: sessions.length,
    sessions,
  });
}

const REACHED_SETUP = session({
  sessionId: "s-setup",
  urlTrail: [`${PRODUCT}/sign-in`, `${PRODUCT}/sign-up`, `${PRODUCT}/first-run`],
  beats: [
    { index: 1, line: `0:00  opened ${PRODUCT}/sign-in` },
    { index: 2, line: "0:20  clicked button[label=Connect]" },
  ],
});

const CONNECTED = session({
  sessionId: "s-connected",
  outcome: "completed",
  urlTrail: [`${PRODUCT}/sign-in`, `${PRODUCT}/first-run`],
  beats: [
    { index: 1, line: `0:00  opened ${PRODUCT}/sign-in` },
    { index: 2, line: "0:20  clicked button[label=Connect]" },
    { index: 3, line: `0:22  saw "${ONBOARDING_MESSAGES.setupSeeingHeading}"` },
  ],
});

const LEFT_FOR_ANOTHER_SITE = session({
  sessionId: "s-left",
  urlTrail: [`${PRODUCT}/first-run`, "https://slack.com/workspace-signin?state=abc"],
});

describe("what counts as connected is an event, not a threshold", () => {
  it("counts only a session the screen told a connection was made", () => {
    expect(hasConnectedSomething(CONNECTED)).toBe(true);
    expect(hasConnectedSomething(REACHED_SETUP)).toBe(false);
  });

  it("takes the fixed part of a message template rather than guessing at its placeholder", () => {
    expect(literalOf(ONBOARDING_MESSAGES.slackWorkspaceConnectedTemplate)).toBe("Connected to");
    expect(literalOf("no placeholder here")).toBe("no placeholder here");
  });

  it("says what it means by connected wherever it reports a number for it", () => {
    const facts = buildCorpusFacts(corpus([CONNECTED, REACHED_SETUP]));

    expect(facts.definitionOfActivation).toBe(ACTIVATION_DEFINITION);
    expect(buildAnalyserPrompt(corpus([CONNECTED]), facts)).toContain(ACTIVATION_DEFINITION);
  });
});

describe("the harness counts the funnel, and every count names its sessions", () => {
  it("leads on how many connected anything, out of how many", () => {
    const facts = buildCorpusFacts(corpus([REACHED_SETUP, LEFT_FOR_ANOTHER_SITE]));

    expect(facts.headline.statement).toBe("0 of 2 sessions connected anything");
    expect(facts.headline.count).toBe(0);
    expect(facts.headline.of).toBe(2);
    expect(facts.facts[0]).toBe(facts.headline);
  });

  it("counts a session that did connect", () => {
    const facts = buildCorpusFacts(corpus([CONNECTED, REACHED_SETUP]));

    expect(facts.headline.statement).toBe("1 of 2 sessions connected anything");
    expect(facts.headline.sessionIds).toEqual(["s-connected"]);
  });

  it("carries the sessions behind every fact, so any of them can be checked", () => {
    const facts = buildCorpusFacts(corpus([CONNECTED, REACHED_SETUP, LEFT_FOR_ANOTHER_SITE]));

    for (const fact of facts.facts) {
      expect(fact.of).toBe(3);
      expect(fact.sessionIds.length).toBe(fact.count);
      expect(fact.statement).toContain(`of ${String(fact.of)} sessions`);
    }
  });

  it("counts the pages reached, which is the funnel", () => {
    const facts = buildCorpusFacts(corpus([CONNECTED, REACHED_SETUP, LEFT_FOR_ANOTHER_SITE]));
    const reached = facts.facts.filter((fact) => fact.id.startsWith("reached:"));

    expect(reached.find((fact) => fact.id === "reached:/sign-in")?.count).toBe(2);
    expect(reached.find((fact) => fact.id === "reached:/first-run")?.count).toBe(3);
  });

  it("names another company's site by its origin, never by the one-time state in its URL", () => {
    expect(pageLabel("https://slack.com/workspace-signin?state=abc", PRODUCT)).toBe(
      "https://slack.com",
    );
    expect(pageLabel(`${PRODUCT}/first-run`, PRODUCT)).toBe("/first-run");

    const facts = buildCorpusFacts(corpus([LEFT_FOR_ANOTHER_SITE]));
    expect(JSON.stringify(facts)).not.toContain("state=abc");
  });

  it("counts the sessions that left for another site and did not come back", () => {
    const facts = buildCorpusFacts(corpus([REACHED_SETUP, LEFT_FOR_ANOTHER_SITE]));
    const left = facts.facts.find((fact) => fact.id === "left-the-product");

    expect(left?.count).toBe(1);
    expect(left?.sessionIds).toEqual(["s-left"]);
  });

  it("counts the sessions that saw one page and no more", () => {
    const facts = buildCorpusFacts(corpus([session({}), REACHED_SETUP]));
    const oneScreen = facts.facts.find((fact) => fact.id === "one-page-only");

    expect(oneScreen?.count).toBe(1);
    expect(oneScreen?.sessionIds).toEqual(["s-one"]);
  });

  it("counts how each session ended, in the product's own outcomes", () => {
    const facts = buildCorpusFacts(
      corpus([CONNECTED, REACHED_SETUP, session({ sessionId: "s-gone", outcome: "gave_up" })]),
    );

    expect(facts.facts.find((fact) => fact.id === "outcome:completed")?.count).toBe(1);
    expect(facts.facts.find((fact) => fact.id === "outcome:gave_up")?.sessionIds).toEqual([
      "s-gone",
    ]);
    expect(facts.facts.find((fact) => fact.id === "outcome:driver_error")).toBeUndefined();
  });

  it("counts the sessions shown the same thing, without a threshold deciding which count", () => {
    const said = `0:22  saw "We could not read what you sent."`;
    const facts = buildCorpusFacts(
      corpus([
        session({ sessionId: "s-a", beats: [{ index: 1, line: said }] }),
        session({ sessionId: "s-b", beats: [{ index: 1, line: said }] }),
        session({ sessionId: "s-c", beats: [{ index: 1, line: `0:03  saw "Welcome."` }] }),
      ]),
    );

    const shared = facts.facts.find((fact) => fact.id.startsWith("said:") && fact.count === 2);
    expect(shared?.sessionIds).toEqual(["s-a", "s-b"]);
    expect(facts.facts.filter((fact) => fact.id.startsWith("said:")).length).toBe(2);
  });
});

describe("the analyser is told the counts rather than asked for them", () => {
  it("puts every fact and its sessions in the prompt, and asks it to open with the headline", () => {
    const input = corpus([CONNECTED, REACHED_SETUP, LEFT_FOR_ANOTHER_SITE]);
    const facts = buildCorpusFacts(input);
    const prompt = buildAnalyserPrompt(input, facts);

    for (const fact of facts.facts) expect(prompt).toContain(fact.statement);
    expect(prompt).toContain("s-connected");
    expect(prompt).toContain(facts.headline.statement);
    expect(prompt).toContain("Your first problem is about it");
  });
});
