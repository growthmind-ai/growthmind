import type { SessionSummariser } from "@growthmind/adapters";
import type { CandidateFinding } from "@growthmind/core";
import type {
  AnalysisRunsRepo,
  FindingPayloadsRepo,
  FindingsRepo,
  SignatureLedgerService,
} from "@growthmind/db";
import { SYSTEM_ACTOR, systemContextFor } from "@growthmind/db/system";
import type { SummarySource, SummaryUsage, TenantContext } from "@growthmind/shared";

import type { TaskLogger } from "../task-logger";

export type AnalysisLogger = TaskLogger;

export const ANALYSIS_ACTOR_ID = SYSTEM_ACTOR.ANALYSIS_TICK;

export type AnalysisLane = {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly projectId: string;
  readonly candidates: readonly CandidateFinding[];
  readonly sessionsConsidered: number;
};

export interface AnalysisLaneSource {
  listDueLanes(now: Date): Promise<readonly AnalysisLane[]>;

  laneForProject(projectId: string, now: Date): Promise<AnalysisLane | null>;
}

export type FindingsRepoFor = (ctx: TenantContext) => FindingsRepo;
export type FindingPayloadsRepoFor = (ctx: TenantContext) => FindingPayloadsRepo;
export type AnalysisRunsRepoFor = (ctx: TenantContext) => AnalysisRunsRepo;
export type SignatureLedgerFor = (ctx: TenantContext) => SignatureLedgerService;

export type ConfiguredSummariser = {
  readonly port: SessionSummariser;
  readonly resolvedModelId: string;
};

export interface AnalysisLaneDeps {
  summariser: ConfiguredSummariser | null;
  findingsFor: FindingsRepoFor;

  payloadsFor: FindingPayloadsRepoFor;
  runsFor: AnalysisRunsRepoFor;
  ledgerFor: SignatureLedgerFor;

  projectCap: number;

  organizationCap: number;

  now: () => Date;
  logger: AnalysisLogger;
}

export interface AnalysisTickDeps extends AnalysisLaneDeps {
  lanes: AnalysisLaneSource;
}

export interface AnalysisTickSummary {
  lanesConsidered: number;

  lanesRun: number;

  lanesAlreadyRunning: number;

  lanesFailed: number;

  lanesErrored: number;

  findingsPersisted: number;

  candidatesUnrenderable: number;

  candidatesRefused: number;

  modelCallsAttempted: number;
}

export type LaneOutcome = "completed" | "failed" | "already_running";

export type CallAttribution =
  | { readonly attempted: false; readonly resolvedModelId: null; readonly usage: SummaryUsage }
  | { readonly attempted: true; readonly resolvedModelId: string; readonly usage: SummaryUsage };

export const NO_CALL: CallAttribution = { attempted: false, resolvedModelId: null, usage: {} };

export type CandidateIdentity = {
  readonly signature: string;
  readonly signatureVersion: number;
};

export type RenderedSummary = {
  readonly summarySource: SummarySource;
  readonly headline: string;

  readonly context: readonly string[];
  readonly attribution: CallAttribution;
};

export type CandidateAction =
  | {
      readonly kind: "persist";

      readonly identity: CandidateIdentity;
      readonly summary: RenderedSummary;
    }
  | { readonly kind: "reuse" }
  | { readonly kind: "unrenderable" }
  /** The surface gate refused this candidate before the ladder began, or its identity
   * could not be derived at all. A member of its own, never `unrenderable`: the two are
   * told apart by a reader of the logs and of the tick summary, and collapsing them
   * would hide a transmission refusal inside a rendering complaint. */
  | { readonly kind: "refused" };

export type CandidatePlan = {
  readonly capExhausted: boolean;
  readonly action: CandidateAction;
};

export function tenantContextFor(lane: AnalysisLane): TenantContext {
  return systemContextFor(SYSTEM_ACTOR.ANALYSIS_TICK, lane);
}
