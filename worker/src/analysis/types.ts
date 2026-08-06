import type { CauseExplainer, SessionSummariser } from "@growthmind/adapters";
import type { CandidateFinding } from "@growthmind/core";
import type {
  AnalysisRunsRepo,
  CauseClaimsRepo,
  DivergencePointsRepo,
  FindingPayloadsRepo,
  FindingsRepo,
  RecordingSummariesRepo,
  ScannedText,
  SignatureLedgerService,
} from "@growthmind/db";
import { SYSTEM_ACTOR, systemContextFor } from "@growthmind/db/system";
import type {
  SummarySource,
  SummaryUsage,
  SuppressionReasonCode,
  TenantContext,
} from "@growthmind/shared";

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
export type CauseClaimsRepoFor = (ctx: TenantContext) => CauseClaimsRepo;
export type DivergencePointsRepoFor = (ctx: TenantContext) => DivergencePointsRepo;

// Only the one method the cause stage's anchor-session resolution needs
// (ADD Decision 4) — narrower than the full repo so a fake doesn't have to
// stand in for methods the cause stage never calls.
export type RecordingSummariesRepoFor = (
  ctx: TenantContext,
) => Pick<RecordingSummariesRepo, "citationsFor">;

export type ConfiguredSummariser = {
  readonly port: SessionSummariser;
  readonly resolvedModelId: string;
};

export type ConfiguredCauseExplainer = {
  readonly port: CauseExplainer;
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

  // ADD Decision 7 Impact list. causeExplainer is resolved once at composition
  // (worker/src/index.ts), like summariser; causeClaimsFor/divergencePointsFor
  // are resolved once per lane by runAnalysisLane, like findingsFor/runsFor,
  // and the resolved repos are passed down to planCause positionally.
  // recordingSummariesFor is not named in the ADD's own Impact list — Decision 4
  // requires a citationsFor call from inside planCause itself to resolve the
  // anchor session, and Wave 0's own test contract (worker/__tests__/analysis/
  // cause.test.ts) fixed this as a dependency on AnalysisLaneDeps rather than a
  // positional argument, so it is threaded the same way causeExplainer is.
  causeExplainer: ConfiguredCauseExplainer | null;
  causeClaimsFor: CauseClaimsRepoFor;
  divergencePointsFor: DivergencePointsRepoFor;
  recordingSummariesFor: RecordingSummariesRepoFor;
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
  readonly headline: ScannedText;

  readonly context: readonly ScannedText[];
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
  | { readonly kind: "refused" }
  /** The ledger resolved a permanent dismissal for this signature. A member of its own,
   * never folded into `refused`: a resolved suppress decision is the ledger working as
   * designed, told apart from "we couldn't establish an identity" or "the consult call
   * itself threw" (both of which are `refused` — see ADD o-019-dismissal-wired Decision 3). */
  | { readonly kind: "suppressed"; readonly reason: SuppressionReasonCode };

export type CandidatePlan = {
  readonly capExhausted: boolean;
  readonly action: CandidateAction;
};

export function tenantContextFor(lane: AnalysisLane): TenantContext {
  return systemContextFor(SYSTEM_ACTOR.ANALYSIS_TICK, lane);
}
