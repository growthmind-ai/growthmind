import { readFileSync } from "node:fs";
import { join } from "node:path";

import { scenarioSchema, type Persona, type Scenario } from "./types";

export const SCENARIO_FILE = "scenario.json";

/** Reads scenario.json only. The answer key lives in a sibling file no run path opens. */
export function loadScenario(directory: string): Scenario {
  const raw = readFileSync(join(directory, SCENARIO_FILE), "utf8");
  return scenarioSchema.parse(JSON.parse(raw));
}

export function resolveFacts(persona: Persona, runId: string): Readonly<Record<string, string>> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(persona.facts)) {
    resolved[key] = value.replaceAll("{run}", runId);
  }
  return resolved;
}
