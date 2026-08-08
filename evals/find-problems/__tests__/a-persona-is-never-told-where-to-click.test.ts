import { describe, expect, it } from "bun:test";

import { buildPersonaPrompt, buildPersonaSystemPrompt } from "../src/persona/brain";
import { loadScenario, resolveFacts } from "../src/scenario/load";
import { join } from "node:path";

const SCENARIO_DIR = join(import.meta.dir, "..", "src", "scenarios", "activation-from-sign-in");

const OBSERVATION = {
  type: "observation" as const,
  step: 1,
  url: "http://localhost:3000/sign-in",
  title: "Sign in",
  headings: ["Sign in"],
  visibleText: "Sign in to Growthmind",
  elements: [
    {
      index: 0,
      tag: "input",
      inputType: "email",
      role: null,
      name: "Email",
      placeholder: "you@company.com",
      href: null,
      hasValue: false,
      disabled: false,
    },
  ],
  screenshotPath: "unused.png",
  consoleErrorCount: 0,
};

describe("a persona decides for itself", () => {
  const scenario = loadScenario(SCENARIO_DIR);

  it("gives every persona an intent with no route and no control named in it", () => {
    for (const persona of scenario.personas) {
      expect(persona.intent).not.toContain("/sign-up");
      expect(persona.intent).not.toContain("/first-run");
      expect(persona.intent).not.toContain("click");
      expect(persona.intent).not.toContain("button");
    }
  });

  it("offers leaving as an outcome rather than only a step cap", () => {
    const system = buildPersonaSystemPrompt(scenario.personas[0]!);

    expect(system).toContain("give_up");
    expect(system).toContain("You are allowed to leave");
  });

  it("never names a page of the product the persona has not seen", () => {
    const system = buildPersonaSystemPrompt(scenario.personas[0]!);

    for (const route of ["/sign-in", "/sign-up", "/first-run", "PostHog", "Slack"]) {
      expect(system).not.toContain(route);
    }
  });

  it("shows the persona only what is on the screen it is looking at", () => {
    const persona = scenario.personas[0]!;
    const prompt = buildPersonaPrompt({
      observation: OBSERVATION,
      history: [],
      facts: resolveFacts(persona, "run-1"),
    });

    expect(prompt).toContain("[0] input type=email");
    expect(prompt).toContain("Sign in to Growthmind");
    expect(prompt).toContain("(this is your first move)");
  });

  it("makes each run's persona email unique so a signup is never a duplicate", () => {
    const persona = scenario.personas[0]!;

    const first = resolveFacts(persona, "run-1")["your email"];
    const second = resolveFacts(persona, "run-2")["your email"];

    expect(first).not.toEqual(second);
    expect(first).not.toContain("{run}");
  });
});
