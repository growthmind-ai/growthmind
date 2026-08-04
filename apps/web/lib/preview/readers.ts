import agentData from "./data/agent.json";
import audienceData from "./data/audience.json";
import channelData from "./data/channel.json";
import collectData from "./data/collect.json";
import fixesData from "./data/fixes.json";
import planData from "./data/plan.json";
import verdictsData from "./data/verdicts.json";

import type {
  AgentView,
  AudienceView,
  ChannelView,
  CollectView,
  FixView,
  PlanView,
  VerdictView,
} from "./types";

// The only place the preview knows its content comes from a file. Every screen goes through
// one of these, so the swap to a real reader is this module and nothing above it.

export function readChannel(): ChannelView {
  return channelData as ChannelView;
}

export function readAudience(): AudienceView {
  return audienceData as AudienceView;
}

export function readPlan(): PlanView {
  return planData as PlanView;
}

export function readAgent(): AgentView {
  return agentData as AgentView;
}

export function readCollect(): CollectView {
  return collectData as CollectView;
}

export function readFixes(): readonly FixView[] {
  return fixesData as readonly FixView[];
}

export function readFixForFinding(findingId: string): FixView | null {
  return readFixes().find((fix) => fix.findingId === findingId) ?? null;
}

export function readVerdicts(): readonly VerdictView[] {
  return verdictsData as readonly VerdictView[];
}

export function readVerdictForFinding(findingId: string): VerdictView | null {
  return readVerdicts().find((verdict) => verdict.findingId === findingId) ?? null;
}
