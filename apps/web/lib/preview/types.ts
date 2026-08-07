// View shapes for the preview surfaces. Deliberately local rather than in `@growthmind/shared`:
// these describe screens, not the product's contracts, and they are meant to be replaced by
// real DTOs once each surface has a reader behind it.

export type BeliefSource = "observed" | "research" | "assumed";

export interface Belief {
  readonly id: string;
  readonly claim: string;
  readonly sources: readonly BeliefSource[];
  readonly evidence: string;
  readonly changed: string;
  readonly settledBy: string | null;
}

export interface AudienceView {
  readonly builtFrom: string;
  readonly confidence: string;
  readonly lastChanged: string;
  readonly beliefs: readonly Belief[];
  readonly arriveWith: readonly { readonly label: string; readonly value: string }[];
  readonly wasBelieved: string;
  readonly nowBelieved: string;
  readonly consequence: string;
  readonly leastSure: readonly string[];
}

export interface RankedChange {
  readonly change: string;
  readonly impact: string;
  readonly confidence: number;
  readonly effort: string;
  readonly score: number;
  readonly picked: boolean;
}

export interface PlanView {
  readonly branch: string;
  readonly aboutToShip: string;
  readonly assessment: string;
  readonly heldAgainst: string;
  readonly ranked: readonly RankedChange[];
  readonly onlyOneReason: string;
  readonly prediction: string;
  readonly trackingPlan: readonly { readonly event: string; readonly note: string | null }[];
  readonly joinable: string;
}

export interface VerdictView {
  readonly findingId: string;
  readonly title: string;
  readonly promisedOn: string;
  readonly promise: string;
  readonly measuredOn: string;
  readonly measurement: string;
  readonly verdict: string;
  readonly record: string;
  readonly howMeasured: string;
}

export interface AgentTool {
  readonly key: string;
  readonly name: string;
  readonly call: string;
  readonly why: string;
  readonly response: string;
}

export interface AgentMoment {
  readonly title: string;
  readonly detail: string;
}

export interface AgentView {
  readonly config: string;
  readonly tools: readonly AgentTool[];
  readonly founderSees: readonly string[];
  readonly agentSees: string;
  readonly moments: readonly AgentMoment[];
  readonly skills: readonly { readonly name: string; readonly does: string }[];
  readonly skillsNote: string;
  readonly cannot: readonly string[];
}
