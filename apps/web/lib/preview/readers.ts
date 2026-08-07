import agentData from "./data/agent.json";
import audienceData from "./data/audience.json";
import planData from "./data/plan.json";
import verdictsData from "./data/verdicts.json";

import type { AgentView, AudienceView, PlanView, VerdictView } from "./types";

// The only place the preview knows its content comes from a file. Every screen goes through
// one of these, so the swap to a real reader is this module and nothing above it.
//
// What is left is the three surfaces with no producer — /audience waits on O-036's ICP
// model, /plan on O-033's brief-time exchange, /experiments on O-028 and O-034 — plus the
// pack half of /agent, which O-032 owns.

export function readAudience(): AudienceView {
  return audienceData as AudienceView;
}

export function readPlan(): PlanView {
  return planData as PlanView;
}

export function readAgent(): AgentView {
  return agentData as AgentView;
}

export function readVerdicts(): readonly VerdictView[] {
  return verdictsData as readonly VerdictView[];
}

export function readVerdictForFinding(findingId: string): VerdictView | null {
  return readVerdicts().find((verdict) => verdict.findingId === findingId) ?? null;
}
