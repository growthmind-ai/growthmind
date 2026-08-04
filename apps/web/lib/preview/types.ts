// View shapes for the preview surfaces. Deliberately local rather than in `@growthmind/shared`:
// these describe screens, not the product's contracts, and they are meant to be replaced by
// real DTOs once each surface has a reader behind it.

export interface ChannelMessage {
  readonly id: string;
  readonly at: string;
  readonly lead: string | null;
  readonly body: readonly string[];
  readonly evidence: string | null;
  readonly forecast: string | null;
  readonly findingId: string | null;
}

export interface ChannelView {
  readonly channel: string;
  readonly messages: readonly ChannelMessage[];
}

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

export type CheckState = "confirmed" | "measuring" | "missing";

export interface FixCheck {
  readonly text: string;
  readonly state: CheckState;
  readonly stamp: string;
}

export interface FixView {
  readonly id: string;
  readonly findingId: string;
  readonly title: string;
  readonly dispatchedTo: string;
  readonly dispatchedOn: string;
  readonly readoutDue: string;
  readonly whatChanges: string;
  readonly where: string;
  readonly introducedByPr: number;
  readonly fixedByPr: number;
  readonly prNote: string;
  readonly checks: readonly FixCheck[];
  readonly trustNote: string;
  readonly stopRule: string;
  readonly log: readonly string[];
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

export interface CollectGroup {
  readonly label: string;
  readonly version: string;
  readonly statements: readonly string[];
}

export interface CollectView {
  readonly groups: readonly CollectGroup[];
  readonly closing: string;
}
