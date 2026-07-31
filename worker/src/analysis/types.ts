// THE ANALYSIS LANE'S VOCABULARY — every shape the lane's four modules share,
// and no behaviour at all.
//
// This file exists so that `plan.ts`, `gates.ts`, `tally.ts` and the tick's own
// run loop can name the same types without importing each other. It is the
// bottom of the lane's dependency graph: it imports from `@growthmind/*` and
// from nothing under `worker/`.
//
// The lane's design rationale — the ladder's order, why each rung is where it
// is, what may never collapse into what — lives in `../tasks/analysis-tick.ts`,
// the composition root that runs it. This file documents SHAPES; that one
// documents the sequence.
import type { SessionSummariser } from "@growthmind/adapters";
import type { CandidateFinding } from "@growthmind/core";
import type { AnalysisRunsRepo, FindingsRepo, SignatureLedgerService } from "@growthmind/db";
import { SYSTEM_ACTOR, systemContextFor } from "@growthmind/db/system";
import type { SummarySource, SummaryUsage, TenantContext } from "@growthmind/shared";

/** The logger surface this lane needs — the subset Graphile Worker's
 * `helpers.logger` already satisfies, so the thin closure in ../index.ts passes
 * it straight through and a test passes a recording fake. */
export interface AnalysisLogger {
  info(message: string): void;
  error(message: string): void;
}

/**
 * This lane's scheduled actor.
 *
 * The value and the `TenantContext` built from it live in
 * `@growthmind/db/system` — one home for every background writer's identity,
 * behind the boundary that keeps `apps/` from minting a system scope at all.
 */
export const ANALYSIS_ACTOR_ID = SYSTEM_ACTOR.ANALYSIS_TICK;

/**
 * One project's analysis lane, as the source read it.
 *
 * THE LANE CARRIES CANDIDATES AND NOTHING ELSE (AD-21). There is no wrapper and
 * no hand-passed key: the walker DERIVES the identity it consumes, from the
 * candidate's own content, through the one producer (`identityFor` in
 * `./gates.ts`). D11's rule — "when surface A computes a value for surface B,
 * the single most reliable wiring is B derives it itself" — applied literally:
 * with the producer of this port still unbuilt, a field it was supposed to fill
 * would be a wire nobody could prove was connected.
 *
 * `candidates` is in the source's DETERMINISTIC ORDER and is processed in that
 * order, one at a time. Cap exhaustion is only reproducible because it is: a
 * lane that spent its budget on whichever candidates a `Promise.all` happened
 * to resolve first would give a different answer on every run for the same
 * input (pinned by W7). Order decides WHICH candidates get the budget; it
 * decides nothing about their identity, which is content-derived and therefore
 * survives a reordering unchanged (D12).
 *
 * `sessionsConsidered` exists so a ZERO is never guessed at. An empty
 * `candidates` with sessions considered means "we looked and nothing was solid
 * enough" (`no_candidates_passed_gate`); with none, it means "we have not
 * looked yet" (`no_sessions_to_analyse`). The task must not infer which — only
 * the source knows, and collapsing the two is the same defect as collapsing the
 * two cap answers.
 */
export type AnalysisLane = {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly projectId: string;
  readonly candidates: readonly CandidateFinding[];
  readonly sessionsConsidered: number;
};

/**
 * Where lanes come from. A PORT, not a repository call, because the producing
 * side does not exist yet: `packages/core` ships detectors, the evidence gate
 * and the candidate contract, but NO orchestrator that turns sessions and
 * events into a `DetectorCorpus`, runs every detector and assembles gate-passed
 * candidates. That assembler is a sprint of its own.
 *
 * Naming the read as a port rather than inlining a query keeps that gap VISIBLE
 * and one-line-fillable — byte for byte the shape `DeliveryLaneSource`
 * (`../tasks/delivery-tick.ts`) set one sprint earlier for exactly this
 * situation.
 *
 * BE HONEST ABOUT WHAT THIS MEANS: `resolveAnalysisComposition()` in
 * ../index.ts returns `null` today, so on a real installation this tick logs a
 * graceful-absence line and persists nothing. The ladder is proven against
 * fakes driving the real entry point, not against production traffic.
 *
 * TODO(the corpus-reader heir): implement this interface as a repository read
 * that assembles gate-passed candidates from sessions and events, and return it
 * from `resolveAnalysisComposition()`. Nothing in the lane changes when it
 * lands — the wire is the only missing part (R-9).
 */
export interface AnalysisLaneSource {
  /** Every project due an analysis decision on this tick. An empty list is an
   * ordinary answer — an installation with no project connected is a supported
   * deployment, not a fault. */
  listDueLanes(now: Date): Promise<readonly AnalysisLane[]>;
}

/**
 * The two repositories and the ledger, org-scoped at construction and injected
 * as FACTORIES over the shipped interfaces rather than as a `ScopedDb`. That is
 * what lets this handler be tested against the CONTRACTS with fakes carrying
 * real state, while the fakes stay compile-checked against the same interfaces
 * production uses — so they cannot drift into agreeing with a repository that
 * no longer exists. The one call to each `create*` lives in ../index.ts, beside
 * the pool it needs.
 */
export type FindingsRepoFor = (ctx: TenantContext) => FindingsRepo;
export type AnalysisRunsRepoFor = (ctx: TenantContext) => AnalysisRunsRepo;
export type SignatureLedgerFor = (ctx: TenantContext) => SignatureLedgerService;

/**
 * The written-explanation capability, as the composition root configured it:
 * the port, AND the id of the model it addresses.
 *
 * ONE VALUE, NOT TWO FIELDS THAT MUST AGREE. The id is not decoration — it is
 * what keeps `resolved_model_id`'s documented rule true on EVERY path. The port
 * is contracted never to throw and carries `resolvedModelId` on both arms of
 * its result, but a port somebody breaks anyway lands in the lane's defensive
 * catch, and until this pairing existed that path wrote `attempted: true` with
 * a null id — collapsing three states (no call, a failed call whose model we
 * know, a failed call whose model we lost) into one stored NULL, on both
 * `findings.resolved_model_id` and, through the run tally, on
 * `analysis_runs.resolved_model_id`.
 *
 * Pairing them structurally rather than passing a second nullable field is the
 * D11 answer: there is no arrangement of these dependencies in which a port
 * exists and the id it addresses does not, so no wire can be left unconnected.
 * `worker/src/index.ts` already resolves the id (`GROWTHMIND_COLDSTART_MODEL ??
 * DEFAULT_COLDSTART_MODEL`) to build the provider — it hands over the same
 * value it gave the SDK, so the id a row names is the id the call addressed.
 */
export type ConfiguredSummariser = {
  readonly port: SessionSummariser;
  readonly resolvedModelId: string;
};

export interface AnalysisTickDeps {
  lanes: AnalysisLaneSource;
  /** `null` ⇒ no written-explanation capability is configured on this
   * installation. THE BRANCH, selected at the composition root (AD-15) — the
   * lane reads no environment variable by any route, and a null here is a
   * decision rather than a caught failure. */
  summariser: ConfiguredSummariser | null;
  findingsFor: FindingsRepoFor;
  runsFor: AnalysisRunsRepoFor;
  ledgerFor: SignatureLedgerFor;
  /** The per-project first-check limit on written explanations
   * (`COLDSTART_MODEL_CALL_CAP`). Passed in from `../analysis-cap.ts` by the
   * composition root; policy never leaks into `packages/db`, whose claim takes
   * both ceilings as parameters. */
  projectCap: number;
  /**
   * The organisation-wide limit on written explanations, summed across every
   * project the organisation has (`ORG_MODEL_CALL_CAP`, AD-23).
   *
   * A SECOND CEILING, NOT A SECOND RUNG. It is handed to the same
   * `claimModelCall` as `projectCap` and refused by the same `cap_exhausted`
   * answer, so the ladder has no branch for it and the customer reads the same
   * `floor_cap_exhausted` sentence either way. Without it the per-project cap
   * bounds nothing in aggregate: no limit exists on how many projects an
   * organisation creates.
   */
  organizationCap: number;
  /** The only way this handler reads time. A fake clock in a test is therefore
   * total: nothing in the lane calls `Date.now()` or `new Date()` by any other
   * route, so the same lane renders and records identically forever. */
  now: () => Date;
  logger: AnalysisLogger;
}

export interface AnalysisTickSummary {
  /** Lanes the source returned. */
  lanesConsidered: number;
  /** Lanes this tick actually opened a run for. */
  lanesRun: number;
  /** Lanes another run already owned. Not a failure — the single-writer
   * guarantee working (D6). */
  lanesAlreadyRunning: number;
  /** Lanes that ended `failed`. */
  lanesFailed: number;
  /** Lanes that threw somewhere this handler could not attribute. Isolated: a
   * non-zero value here does not mean the tick failed. */
  lanesErrored: number;
  /** Findings written or already standing after this tick. */
  findingsPersisted: number;
  /** Candidates the floor itself refused to render, so nothing was written for
   * them. Counted separately because it is neither a finding nor a fault of the
   * model lane — see `floorTextFor`. Also persisted per run on
   * `analysis_runs.candidates_unrenderable`: this number is the tick's own
   * report, and a number that lives only here dies with the process. */
  candidatesUnrenderable: number;
  /** Candidates refused BEFORE the ladder because their surface was not in its
   * normalised form (security audit M-1). Counted apart from every other number
   * here: nothing was claimed, nothing was sent and nothing was written for
   * them, and folding them into `candidatesUnrenderable` would read as "the
   * floor could not phrase it" when the truth is "we would not transmit it".
   * Persisted per run on `analysis_runs.candidates_refused`, kept apart there
   * for the same reason. */
  candidatesRefused: number;
  /** Model calls this tick actually made. */
  modelCallsAttempted: number;
}

/** What one lane's turn produced. A value, never an exception — an isolated
 * failure that travels as a throw is a failure that can abort a sibling (D8). */
export type LaneOutcome = "completed" | "failed" | "already_running";

/**
 * A model call's attribution, carried whether the call succeeded or not.
 *
 * A FAILED call still addressed a model and still consumed the cap, so
 * `resolvedModelId` travels on both arms and `usage` may be reported on either.
 *
 * A DISCRIMINATED UNION, so `attempted ⇒ a model id` is a COMPILE rule rather
 * than a comment. `findings.resolved_model_id` and
 * `analysis_runs.resolved_model_id` both document "null iff no call was
 * attempted", and this type is what makes that documentation true: there is no
 * value of this type carrying `attempted: true` and a null id, so no branch —
 * including the defensive catch around a port contracted never to throw — can
 * write the ambiguous NULL by forgetting to. The alternative fix, weakening the
 * two columns' headers to "null is ambiguous", would have made a stored fact
 * unreadable forever to save one field on a dependency.
 */
export type CallAttribution =
  | { readonly attempted: false; readonly resolvedModelId: null; readonly usage: SummaryUsage }
  | { readonly attempted: true; readonly resolvedModelId: string; readonly usage: SummaryUsage };

/** No call was made at all: the no-key rung, and the cap-refused rung. */
export const NO_CALL: CallAttribution = { attempted: false, resolvedModelId: null, usage: {} };

/**
 * ONE CANDIDATE'S IDENTITY, derived once per candidate and used by all three
 * sites that key on it — the cap claim, the reuse read, and the persist (AD-20).
 *
 * Carried as a value from the derivation site rather than recomputed at each
 * site: three calls could not disagree today, but a value computed once and
 * passed is the shape in which they can never disagree tomorrow. Nothing here
 * hashes anything — see `identityFor` in `./gates.ts`.
 */
export type CandidateIdentity = {
  readonly signature: string;
  readonly signatureVersion: number;
};

/** Everything one candidate contributes to its finding row and to the run. */
export type RenderedSummary = {
  readonly summarySource: SummarySource;
  readonly headline: string;
  /** ONE SENTENCE PER ELEMENT, for both lanes (AD-8). Never a blob a consumer
   * would have to re-split — the step that stops being reliable the moment a
   * model writes it. */
  readonly context: readonly string[];
  readonly attribution: CallAttribution;
};

/**
 * What to do with one candidate. `reuse` is not a degenerate `persist`: a prior
 * run already claimed this candidate's budget AND wrote its finding, so there is
 * nothing to call, nothing to write, and nothing to record — and saying so as a
 * distinct member is what keeps a replay from looking like a fresh success.
 */
export type CandidateAction =
  | {
      readonly kind: "persist";
      /** The identity this row is written under — the SAME value the claim
       * above it was taken on, carried rather than re-derived. */
      readonly identity: CandidateIdentity;
      readonly summary: RenderedSummary;
    }
  | { readonly kind: "reuse" }
  | { readonly kind: "unrenderable" }
  /** The surface gate refused this candidate before the ladder began — or its
   * identity could not be derived at all (AD-20.5). A member of its own, never
   * `unrenderable`: the two are told apart by a reader of the logs and of the
   * tick summary, and collapsing them would hide a transmission refusal inside
   * a rendering complaint. */
  | { readonly kind: "refused" };

/**
 * One candidate's turn, and whether the cap refused it.
 *
 * `capExhausted` sits BESIDE the action rather than inside the persisted
 * summary, and that placement is the point: it is a fact about the CLAIM, so it
 * must survive every downstream outcome — including the one where the floor
 * then refuses to render the candidate at all. Reading it off a persisted row
 * would make a spent cap silently read as a run that finished its list the
 * moment anything after the claim went wrong (SAC-10).
 */
export type CandidatePlan = {
  readonly capExhausted: boolean;
  readonly action: CandidateAction;
};

/**
 * Builds the `TenantContext` a lane's writes run as, from the lane row itself —
 * never from a payload, never from a caller-supplied id (D7).
 *
 * The parse and the actor both live in `@growthmind/db/system`; this names
 * WHICH actor and nothing else.
 */
export function tenantContextFor(lane: AnalysisLane): TenantContext {
  return systemContextFor(SYSTEM_ACTOR.ANALYSIS_TICK, lane);
}
