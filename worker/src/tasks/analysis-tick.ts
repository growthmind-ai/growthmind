/**
 * THE ANALYSIS LANE'S COMPOSITION ROOT (O-011 FR-M3…FR-M16, ADD AD-0/AD-9).
 *
 * A plain exported async function with no queue types in its signature, so the
 * whole lane is driven end to end through the REAL consumer entry point with
 * fakes at the ports (D11). Registration lives in ../index.ts, the only
 * queue-aware file — the split ./delivery-tick.ts and ./session-source-poll.ts
 * both use, for the same reason.
 *
 * Nothing here decides what is TRUE about a customer's product. Every judgement
 * was made upstream by a pure function that already shipped; this file's whole
 * job is to run a fixed ladder in the one order whose failure classes cannot
 * collapse into each other, and to make sure a finding lands whichever rung it
 * falls to.
 *
 * ── ONE GATE STANDS BEFORE THE LADDER, AND IT IS NOT A RUNG ─────────────────
 * A candidate whose `surface` is not already in its normalised form is REFUSED
 * before anything is claimed, sent, written or HASHED (security audit M-1). It
 * is not a degradation — there is no rung for it, no `floor_*` sentence, and no
 * finding row — because the hazard it answers is not "we could not write this
 * up" but "this value may not leave the process at all". See
 * `surfaceIsSafeToSend`.
 *
 * ── THE IDENTITY IS DERIVED HERE, ONCE, BEFORE THE CLAIM (ADD v2 AD-20) ─────
 * Immediately after that gate and before rung 1, `identityFor` calls
 * `computeFindingSignature` — the product's ONE producer of a signature — and
 * the value it returns is what the cap claim, the reuse read and the persist
 * all key on. Content-derived, so the same problem is the same identity across
 * ticks, across reorderings and across processes; a positional or
 * tick-prefixed handle would fork every hour and quietly turn a lifetime cap
 * into a per-tick one. Nothing in `worker/` hashes anything: a second
 * composition of `signatureTuple` and `sha256Hex` is the D12 fork this
 * arrangement exists to make impossible. A derivation that throws refuses ONE
 * candidate and never the run (AD-20.5).
 *
 * ── THE LADDER, IN EXACTLY THIS ORDER (ADD AD-9) ────────────────────────────
 *
 *   no key            -> floor_no_key_configured       [0 claims, 0 calls]
 *   cap spent         -> floor_cap_exhausted           [0 calls]
 *   already claimed   -> reuse the persisted finding    [0 calls, no 2nd row]
 *   call_failed       -> floor_model_call_failed        [claim consumed]
 *   output_invalid    -> floor_model_output_invalid     [claim consumed]
 *   guard rejected    -> floor_model_text_rejected      [claim consumed]
 *   otherwise         -> model_rendered
 *
 * ONE CALL SITE PER RUNG, and the order is the contract. Three properties fall
 * out of it and out of nothing else:
 *
 *   - THE KEY CHECK PRECEDES THE CLAIM, so an installation with no key consumes
 *     zero budget. The branch SELECTS the no-key lane; it never tries and fails
 *     (AD-15). `deps.summariser` is `null` there and no port is reached for.
 *   - THE CLAIM PRECEDES THE CALL, so a FAILED call still consumes the cap
 *     (FR-M6). A project cannot buy unlimited retries by failing.
 *   - `output_invalid` AND `text_rejected` NEVER COLLAPSE (D10,
 *     `shared/src/summary/types.ts:84-99`). "The shape could not be read" and
 *     "the prose asserted something it may not" are different debugging signals
 *     and different sentences to a customer. They are two branches, in that
 *     order, reachable only in that order: the guard runs ONLY over text the
 *     output schema has already parsed.
 *
 * ── THE GUARD JUDGES THE TEXT AS IT WILL BE PERSISTED (D11) ─────────────────
 * A gate that clears a DIFFERENT string from the one stored is a gate that does
 * nothing. So the model's prose is segmented FIRST, the guard is handed the
 * join of those very sentences, and the array persisted is that same array —
 * split once, by the one function whose refusal (`null`) is itself a rejection
 * (AD-7), and never re-split downstream.
 *
 * ── EVERY DEGRADED PATH STILL PERSISTS THE FINDING ──────────────────────────
 * A missing written explanation is an absence of PROSE, never an absence of the
 * finding (SAC-6). The numbers, the surface, the class, the window and the
 * evidence shape are identical whichever rung applied; only the text differs,
 * and `summary_source` says which rung it was.
 *
 * ── EVERY EXIT PATH IS TERMINAL (D8) ────────────────────────────────────────
 * `analysis_runs` carries a partial unique index on `(org, project) WHERE
 * status = 'running'`, so a row left `running` does not merely look untidy — it
 * makes every future run for that project un-openable and JAMS the lane
 * silently, forever. Every path out of an opened run therefore closes it:
 * the ordinary end, a spent cap, a candidate the floor refused, a thrown port,
 * and a store that stopped answering. The only path that can leave a `running`
 * row is a close that itself fails; that one is logged loudly, and the
 * repository's lease (`ANALYSIS_RUN_LEASE_MS`) hands the lane back to a later
 * tick rather than leaving it jammed.
 *
 * ── A CANDIDATE THAT PRODUCED NO FINDING IS A FACT THE RUN ROW CARRIES ──────
 * Two candidates leave the walk with nothing written: one the surface gate
 * refused to transmit, one the floor could not phrase. Both are COUNTED ONTO
 * THE RUN (`candidates_refused`, `candidates_unrenderable`) and not merely into
 * this process's memory. A run in which every candidate fell out would
 * otherwise close `completed` / `produced_findings` / `ran_to_completion` over
 * zero rows — "we lost some" decaying into "we checked everything", SAC-10's
 * own shape one level down. No floor sentence is invented for them: nothing
 * honest could be written, so the count is what is stored.
 *
 * ── THE CAP'S EXHAUSTION IS A NAMED STATE, NEVER SILENCE (SAC-10) ───────────
 * Past the cap, candidates are still persisted — under `floor_cap_exhausted` —
 * and the run records `stop_reason = cap_exhausted`. Dropping them would make
 * "we stopped early" indistinguishable from "there was nothing more to find",
 * which would tell a founder their product is quieter than it is.
 *
 * "The cap" is TWO ceilings (ADD v2 AD-23) — per project, and per organisation
 * across all its projects — checked in the one claim statement and refusing
 * with the one answer. This file therefore has no branch for the difference:
 * both land on rung 3, both render the same sentence, and both close the run
 * `cap_exhausted`. See `../analysis-cap.ts` for why one sentence covers two
 * causes.
 *
 * ── IDEMPOTENCY IS STRUCTURAL, NOT REMEMBERED (D4/D6) ───────────────────────
 * Two mechanisms, neither of which is a check-then-write: `claimModelCall` is
 * one conditional insert against a unique `(org, project, signature)`, and
 * `persist` is one insert against the same tuple on `findings`. A Graphile
 * Worker replay of this task therefore conflicts on both and re-calls no model
 * and mints no second finding — and because the signature is derived from the
 * candidate's content rather than from its position or the tick's instant, so
 * does a LATER TICK looking at the same problem.
 *
 * ── THERE IS NO PAYLOAD, AND THAT IS THE VALIDATION ─────────────────────────
 * The task is cron-triggered. `runAnalysisTick` takes dependencies and reads no
 * payload by any route, so a hand-enqueued job carrying junk cannot widen
 * anything — a stronger guarantee than parsing a value cron never sends, and
 * the same shape both shipped ticks use (`../index.ts` passes `_payload`).
 * Each lane's tenant scope comes from the lane ROW the source read (D7); there
 * is nothing a caller could supply an organization id through even in
 * principle.
 *
 * ── THE VENDOR IS UNNAMEABLE HERE ───────────────────────────────────────────
 * `SessionSummariser` is a port from `@growthmind/adapters`. Neither `ai` nor
 * `@ai-sdk/anthropic` is imported in this file or anywhere in `worker/`; the
 * composition root selects an implementation, and this file cannot learn its
 * name. No customer-facing sentence is authored here either — every one comes
 * from `@growthmind/shared` through `renderFloorSummary`.
 */
import type { SessionSummariser, SummariseInput } from "@growthmind/adapters";
import type { CandidateFinding, FloorSummary, FloorSummarySource } from "@growthmind/core";
import {
  guardModelText,
  joinSentences,
  modelSummaryOutputSchema,
  renderFloorSummary,
  SIGNATURE_TUPLE_VERSION,
  splitSentences,
} from "@growthmind/core";
import type {
  AnalysisRunRecord,
  AnalysisRunsRepo,
  FindingsRepo,
  MeasuredCountRow,
  SignatureLedgerService,
} from "@growthmind/db";
import { computeFindingSignature } from "@growthmind/db";
import { SYSTEM_ACTOR, systemContextFor } from "@growthmind/db/system";
import type {
  AnalysisOutcome,
  AnalysisStopReason,
  SummaryRenderResult,
  SummarySource,
  SummaryUsage,
  TenantContext,
} from "@growthmind/shared";
import {
  ANALYSIS_RUN_STATUS_MESSAGES,
  describeError,
  isNormalisedUrlPath,
} from "@growthmind/shared";

/**
 * The one-home sentence for "this check did not finish", resolved ONCE.
 *
 * `failure_reason` is what a founder reads when a run ends early, so it is
 * drawn from `@growthmind/shared`'s audited table rather than authored here —
 * a second copy of a customer-facing sentence is how the one-home rule dies.
 * It is deliberately NOT the thrown error's own text: a store or a port can put
 * ids, hostnames and stack fragments in a message, and this column is read by a
 * person. The log gets the detail (logs are ours); the row gets this.
 */
const CHECK_DID_NOT_FINISH: string = ANALYSIS_RUN_STATUS_MESSAGES.failed;

/** The logger surface this handler needs — the subset Graphile Worker's
 * `helpers.logger` already satisfies, so the thin closure in ../index.ts passes
 * it straight through and a test passes a recording fake. */
export interface AnalysisLogger {
  info(message: string): void;
  error(message: string): void;
}

/**
 * This lane's scheduled actor, re-exported for the lane source and the tests
 * that assert who wrote a row.
 *
 * The value and the `TenantContext` built from it live in
 * `@growthmind/db/system` — one home for every background writer's identity,
 * behind the boundary that keeps `apps/` from minting a system scope at all.
 */
export const ANALYSIS_ACTOR_ID = SYSTEM_ACTOR.ANALYSIS_TICK;

/**
 * One project's analysis lane, as the source read it.
 *
 * THE LANE CARRIES CANDIDATES AND NOTHING ELSE (ADD v2 AD-21). There is no
 * wrapper and no hand-passed key: this walker DERIVES the identity it consumes,
 * from the candidate's own content, through the one producer
 * (`identityFor` below). D11's rule — "when surface A computes a value for
 * surface B, the single most reliable wiring is B derives it itself" — applied
 * literally: with the producer of this port still unbuilt, a field it was
 * supposed to fill would be a wire nobody could prove was connected.
 *
 * `candidates` is in the source's DETERMINISTIC ORDER and is processed in that
 * order, one at a time. Cap exhaustion is only reproducible because it is: a
 * lane that spent its budget on whichever candidates a `Promise.all` happened
 * to resolve first would give a different answer on every run for the same
 * input (ADD §7.5, pinned by W7). Order decides WHICH candidates get the
 * budget; it decides nothing about their identity, which is content-derived and
 * therefore survives a reordering unchanged (D12).
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
 * candidates. That assembler is a sprint of its own (ADD §3.1, option B).
 *
 * Naming the read as a port rather than inlining a query keeps that gap VISIBLE
 * and one-line-fillable — byte for byte the shape `DeliveryLaneSource`
 * (`./delivery-tick.ts`) set one sprint ago for exactly this situation.
 *
 * BE HONEST ABOUT WHAT THIS MEANS: `resolveAnalysisComposition()` in
 * ../index.ts returns `null` today, so on a real installation this tick logs a
 * graceful-absence line and persists nothing. The ladder below is proven
 * against fakes driving this real entry point, not against production traffic.
 *
 * TODO(the corpus-reader heir of ADD AD-0): implement this interface as a
 * repository read that assembles gate-passed candidates from sessions and
 * events, and return it from `resolveAnalysisComposition()`. Nothing in this
 * file changes when it lands — the wire is the only missing part (ADD R-9).
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
 * its result, but a port somebody breaks anyway lands in this file's defensive
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
   * installation. THE BRANCH, selected at the composition root (AD-15) — this
   * file reads no environment variable by any route, and a null here is a
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
   * project the organisation has (`ORG_MODEL_CALL_CAP`, ADD AD-23).
   *
   * A SECOND CEILING, NOT A SECOND RUNG. It is handed to the same
   * `claimModelCall` as `projectCap` and refused by the same `cap_exhausted`
   * answer, so the ladder below has no branch for it and the customer reads the
   * same `floor_cap_exhausted` sentence either way. Without it the per-project
   * cap bounds nothing in aggregate: no limit exists on how many projects an
   * organisation creates.
   */
  organizationCap: number;
  /** The only way this handler reads time. A fake clock in a test is therefore
   * total: nothing here calls `Date.now()` or `new Date()` by any other route,
   * so the same lane renders and records identically forever. */
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
type LaneOutcome = "completed" | "failed" | "already_running";

/**
 * A model call's attribution, carried whether the call succeeded or not.
 *
 * A FAILED call still addressed a model and still consumed the cap, so
 * `resolvedModelId` travels on both arms (`shared/src/summary/types.ts:173-182`)
 * and `usage` may be reported on either.
 *
 * A DISCRIMINATED UNION, so `attempted ⇒ a model id` is a COMPILE rule rather
 * than a comment. `findings.resolved_model_id` and `analysis_runs.
 * resolved_model_id` both document "null iff no call was attempted", and this
 * type is what makes that documentation true: there is no value of this type
 * carrying `attempted: true` and a null id, so no branch below — including the
 * defensive catch around a port contracted never to throw — can write the
 * ambiguous NULL by forgetting to. The alternative fix, weakening the two
 * columns' headers to "null is ambiguous", would have made a stored fact
 * unreadable forever to save one field on a dependency.
 */
type CallAttribution =
  | { readonly attempted: false; readonly resolvedModelId: null; readonly usage: SummaryUsage }
  | { readonly attempted: true; readonly resolvedModelId: string; readonly usage: SummaryUsage };

/** No call was made at all: the no-key rung, and the cap-refused rung. */
const NO_CALL: CallAttribution = { attempted: false, resolvedModelId: null, usage: {} };

/**
 * ONE CANDIDATE'S IDENTITY, derived once per candidate and used by all three
 * sites that key on it — the cap claim, the reuse read, and the persist
 * (ADD v2 AD-20).
 *
 * Carried as a value from the derivation site rather than recomputed at each
 * site: three calls could not disagree today, but a value computed once and
 * passed is the shape in which they can never disagree tomorrow. Nothing here
 * hashes anything — see `identityFor`.
 */
type CandidateIdentity = {
  readonly signature: string;
  readonly signatureVersion: number;
};

/** Everything one candidate contributes to its finding row and to the run. */
type RenderedSummary = {
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
type CandidateAction =
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
type CandidatePlan = {
  readonly capExhausted: boolean;
  readonly action: CandidateAction;
};

/**
 * Builds the `TenantContext` this lane's writes run as, from the lane row
 * itself — never from a payload, never from a caller-supplied id (D7).
 *
 * The parse and the actor both live in `@growthmind/db/system`; this names
 * WHICH actor and nothing else.
 */
function tenantContextFor(lane: AnalysisLane): TenantContext {
  return systemContextFor(SYSTEM_ACTOR.ANALYSIS_TICK, lane);
}

/**
 * The branded `MeasuredCount`s, down-shaped for persistence.
 *
 * Written out field by field rather than cast. `MeasuredCount` carries a
 * module-private brand symbol that no round-trip through jsonb can recreate, and
 * its `basis.setAside` is a READONLY array the repository's row shape does not
 * accept — so this is a real boundary, not a formality. Nothing is computed
 * here: every number is copied, none is derived, and no count is dropped.
 */
function toCountRows(candidate: CandidateFinding): readonly MeasuredCountRow[] {
  return candidate.counts.map((count) => ({
    numerator: count.numerator,
    denominator: count.denominator,
    unit: count.unit,
    timeframe: { start: count.timeframe.start, end: count.timeframe.end },
    basis: {
      totalInWindow: count.basis.totalInWindow,
      kept: count.basis.kept,
      setAside: count.basis.setAside.map((row) => ({
        reason: row.reason,
        count: row.count,
        label: row.label,
      })),
    },
  }));
}

/** The gate-proven state the renderer is allowed to see, and nothing else. No
 * raw session data, no trace, no evidence shape — the port is a renderer, and
 * what it cannot read it cannot restate. */
function summariseInputFor(candidate: CandidateFinding): SummariseInput {
  return {
    finalClass: candidate.finalClass,
    surface: candidate.surface,
    counts: candidate.counts.map((count) => ({
      numerator: count.numerator,
      denominator: count.denominator,
      unit: count.unit,
    })),
    timeframe: { start: candidate.timeframe.start, end: candidate.timeframe.end },
    // What the confidence RESTS ON, never a confidence value. There is no
    // numeric confidence in this product and the model must not invent one.
    confidenceBasis: candidate.ranking.confidenceBasis,
  };
}

/**
 * The deterministic floor, or `null` if the floor itself refuses.
 *
 * `renderFloorSummary` THROWS by design rather than guessing — on a surface that
 * is not already normalised, on a `counts` arity that disagrees with the
 * detector's declared roles, on a template it cannot fully resolve
 * (`core/src/summary/floor.ts:166-224`). Its own header hands the isolation half
 * forward by name: "one refused candidate must not abort a whole run … it
 * belongs to whatever eventually calls this". This is that caller, and this
 * function is where the obligation is discharged.
 *
 * FAIL DIRECTION: the candidate is REFUSED, loudly, and no row is written for
 * it. Both alternatives are worse. Persisting the numbers under one of the
 * `floor_*` sentences would state "This shows the numbers on their own" over
 * text carrying no numbers — a false claim about what the reader is looking at,
 * drawn from a sentence written for a different cause. Authoring a replacement
 * sentence here would put a customer-facing string outside
 * `@growthmind/shared`, which is the one home it may have. A gap somebody
 * notices in the log is the honest answer, and it is the direction the floor
 * itself already chose for every refusal above.
 *
 * THE MESSAGE NAMES THE SIGNATURE AND THE CAUSE, NEVER THE CANDIDATE. A
 * refusal's own text can name a page path or a count, and neither is a fact
 * about this codebase — the same discipline as `floor.ts:126-129`.
 */
function floorTextFor(
  signature: string,
  candidate: CandidateFinding,
  source: FloorSummarySource,
  logger: AnalysisLogger,
): FloorSummary | null {
  try {
    return renderFloorSummary({ candidate, source });
  } catch (error) {
    logger.error(
      `analysis tick: candidate ${signature} could not be written up even without a model, so nothing was recorded for it — ${describeError(error)}`,
    );
    return null;
  }
}

/**
 * THE SURFACE GATE (security audit M-1). `false` refuses the candidate outright,
 * before the ladder starts.
 *
 * WHAT IT ANSWERS. `CandidateFinding.surface` is only `z.string().min(1)`
 * (`core/src/findings/candidate.ts:91`), so a raw url path can arrive carrying a
 * live password-reset token or an email address in a segment. This lane has two
 * egress points for that value and both are irreversible: `render` hands it to a
 * third party, and `persist` writes it to a permanent column. Product decisions
 * §2–§4 forbid PII in the event stream, and neither egress can be walked back
 * once taken.
 *
 * WHY IT IS HERE AND NOT LOWER. The check itself is not new —
 * `assertNormalisedSurfaceForSignature` in
 * `db/src/services/signature-ledger.service.ts` was added by an earlier audit
 * for this exact reason. But in this lane it ran at `recordIdentity`, which is
 * AFTER both egress points, and its throw is swallowed there by design (D8). A
 * correct check placed after the thing it protects is an inert check. So the
 * predicate is asked once, at the top, where refusing still costs nothing.
 *
 * FAIL DIRECTION: WITHHOLD (D10). `isNormalisedUrlPath` answers `false` on any
 * doubt, and the answer to doubt about a value that may be a secret is to not
 * send it. The bound on that is the identity case — an already-normalised path
 * is a no-op through the normaliser — so "refuse on doubt" cannot degrade into
 * "refuse on everything"; `packages/shared/__tests__/sessions/url-path.test.ts`
 * pins the near-miss controls, and W13 below pins this lane's own fixtures.
 *
 * A REFUSAL IS NOT A DEGRADATION. No claim is taken, no call is made, no row is
 * written, no `floor_*` sentence is chosen and the run is NOT failed — one
 * candidate the gate refused must not cost this project every other candidate
 * (D8 isolation). It is counted, so the refusal is visible rather than silent.
 *
 * THE MESSAGE NAMES THE POSITION AND THE CAUSE, NEVER THE SURFACE. The
 * offending value IS the suspected secret, and a log line is a third place it
 * would then live. It cannot name a signature either: this gate stands BEFORE
 * the derivation, precisely because deriving an identity from a surface that
 * may be a secret is one of the two egress points it exists to prevent
 * (`identityFor` hashes it into a permanent value). The candidate's position in
 * the lane is what remains — enough to tell two refusals in one tick apart, and
 * a fact about this walk rather than about somebody's product. Same discipline
 * as `floorTextFor` above and `core/src/summary/output-schema.ts:28-32`.
 */
function surfaceIsSafeToSend(
  position: number,
  projectId: string,
  candidate: CandidateFinding,
  logger: AnalysisLogger,
): boolean {
  if (isNormalisedUrlPath(candidate.surface)) return true;

  logger.error(
    `analysis tick: candidate ${String(position)} of project ${projectId} arrived with a page path that is not in the form this product stores, so it was not sent to a model, not written down, and nothing was recorded for it`,
  );
  return false;
}

/**
 * THE FINDING'S IDENTITY, DERIVED ONCE PER CANDIDATE (ADD v2 AD-20). `null`
 * refuses the candidate.
 *
 * NO NEW HASHING. `computeFindingSignature` (`@growthmind/db`, which composes
 * `signatureTuple` from `@growthmind/core` and `sha256Hex`) is the ONE producer
 * of a signature in this product, and this function does nothing but call it
 * and pair the answer with the tuple version that produced it. A second
 * composition of those two pieces — here or anywhere — would be a second home
 * for identity, and two homes for one identity is the D12 fork every guarantee
 * in this lane hangs off avoiding.
 *
 * WHY THE WALKER DERIVES IT RATHER THAN RECEIVING IT (D11, AD-21). The walker
 * is the CONSUMER: it claims the cap on this value, reads back a prior finding
 * on this value, and persists on this value. A key handed in by the lane source
 * would be a wire between an unbuilt producer and three consumers, and a wire
 * nobody can drive end to end is a wire that is already broken. Deriving it
 * here leaves nothing to sever.
 *
 * WHY IT IS DERIVED FROM CONTENT AND NOT FROM POSITION. An ordinal, or a
 * tick-instant prefix, mints a fresh identity on every tick: the cap's unique
 * index would match nothing and a lifetime ceiling would silently become a
 * per-tick one, while `findBySignature`'s reuse rung never hit. Content
 * derivation is what makes "one claim per distinct problem, for the lifetime of
 * this project" a property of the schema rather than of a comment.
 *
 * FAIL DIRECTION: REFUSE THIS CANDIDATE, NEVER ABORT THE RUN (AD-20.5, D8).
 * `computeFindingSignature` throws on a surface that is not already its own
 * normalised form. `surfaceIsSafeToSend` refuses exactly those candidates one
 * step earlier, so this throw is UNREACHABLE today — it is caught anyway,
 * because a per-candidate fault that travels as a throw is a fault that costs
 * this project every candidate after it. The message names the cause and the
 * position, never the surface, for `surfaceIsSafeToSend`'s reason.
 */
function identityFor(
  position: number,
  projectId: string,
  candidate: CandidateFinding,
  logger: AnalysisLogger,
): CandidateIdentity | null {
  try {
    return {
      signature: computeFindingSignature({
        projectId,
        surface: candidate.surface,
        symptomClass: candidate.finalClass,
        evidenceShape: candidate.evidenceShape,
      }),
      signatureVersion: SIGNATURE_TUPLE_VERSION,
    };
  } catch (error) {
    logger.error(
      `analysis tick: candidate ${String(position)} of project ${projectId} could not be given a permanent identity, so nothing was claimed, sent or written for it — ${describeError(error)}`,
    );
    return null;
  }
}

/** One floor rung, assembled. `floor.source` is carried through exactly as the
 * renderer returned it — this never re-states the cause it asked for. */
function floorAction(
  floor: FloorSummary,
  attribution: CallAttribution,
  identity: CandidateIdentity,
): CandidateAction {
  return {
    kind: "persist",
    identity,
    summary: {
      summarySource: floor.source,
      headline: floor.headline,
      context: floor.context,
      attribution,
    },
  };
}

/**
 * THE LADDER (AD-9). One rung per branch, in the one order the failure classes
 * cannot collapse in, and every branch returns a plan rather than throwing.
 *
 * The only throws that escape are from the CLAIM and the reuse READ — the two
 * database calls. Those are lane-fatal by design: a claim that cannot be taken
 * means the cap cannot be accounted for, and continuing without it would spend
 * budget nobody can count.
 */
async function planCandidate(
  deps: AnalysisTickDeps,
  lane: AnalysisLane,
  runs: AnalysisRunsRepo,
  findings: FindingsRepo,
  run: AnalysisRunRecord,
  candidate: CandidateFinding,
  position: number,
  tickAt: Date,
): Promise<CandidatePlan> {
  // ── GATE 0: THE SURFACE. NOT A RUNG — it stands before the whole ladder, and
  //    before rung 1 rather than beside it, because the no-key lane persists a
  //    finding too and `persist` is an egress point in its own right. It also
  //    stands before the IDENTITY DERIVATION below, which hashes the surface
  //    into a permanent value and is therefore an egress point of the same kind.
  //    Refusing here is the only position from which zero claims, zero calls,
  //    zero rows and zero signatures are all guaranteed by construction rather
  //    than by every branch below remembering to check. See
  //    `surfaceIsSafeToSend`.
  if (!surfaceIsSafeToSend(position, lane.projectId, candidate, deps.logger)) {
    return { capExhausted: false, action: { kind: "refused" } };
  }

  // ── THE IDENTITY, DERIVED ONCE AND BEFORE THE CLAIM (AD-20). Every site below
  //    that keys on this candidate — the cap claim, the reuse read, the
  //    persist — names THIS value, so the three can never disagree. A refusal
  //    here is a per-candidate refusal and never a run abort (AD-20.5).
  const identity = identityFor(position, lane.projectId, candidate, deps.logger);
  if (identity === null) {
    return { capExhausted: false, action: { kind: "refused" } };
  }

  const floorPlanFor = (
    source: FloorSummarySource,
    attribution: CallAttribution,
    capExhausted = false,
  ): CandidatePlan => {
    const floor = floorTextFor(identity.signature, candidate, source, deps.logger);
    return {
      capExhausted,
      action:
        floor === null ? { kind: "unrenderable" } : floorAction(floor, attribution, identity),
    };
  };

  // ── RUNG 1: NO KEY. The branch SELECTS this lane (AD-15); it does not try a
  //    port and swallow the failure. Zero claims and zero calls follow from the
  //    key check standing BEFORE the claim, and from nothing else.
  if (deps.summariser === null) {
    return floorPlanFor("floor_no_key_configured", NO_CALL);
  }

  // The port AND the id it addresses, taken together and once. Every branch
  // below that records an attempt attributes it to THIS id — see
  // `ConfiguredSummariser`.
  const summariser = deps.summariser;

  // ── RUNG 2: THE CAP CLAIM. One conditional insert, NO prior read (D6). Both
  //    count predicates and the unique index are evaluated together, so two
  //    overlapping runs cannot both conclude there is budget, and its three
  //    answers stay distinguishable without a check-then-write window.
  //
  //    TWO CEILINGS, ONE RUNG (AD-23). The per-project limit and the
  //    organisation-wide one are handed over together and refuse with the same
  //    answer, so there is no fourth rung and no second sentence: which ceiling
  //    stopped a candidate is not a distinction the shipped vocabulary can
  //    express, and inventing one here would author a customer-facing string
  //    outside `@growthmind/shared`.
  const claim = await runs.claimModelCall({
    projectId: lane.projectId,
    runId: run.id,
    signature: identity.signature,
    signatureVersion: identity.signatureVersion,
    projectCap: deps.projectCap,
    organizationCap: deps.organizationCap,
    at: tickAt,
  });

  if (!claim.claimed) {
    if (claim.reason === "cap_exhausted") {
      // ── RUNG 3: THE CAP IS SPENT. The candidate is STILL PERSISTED, with the
      //    numbers and without prose, and the run will say it stopped early.
      return floorPlanFor("floor_cap_exhausted", NO_CALL, true);
    }

    // ── RUNG 4: ALREADY CLAIMED. A previous run — or a Graphile Worker replay
    //    of this very job — owns this candidate's budget. Calling again would
    //    be billed twice and would overwrite text a customer may already have
    //    read, so this rung makes NO call under any circumstance. With a
    //    content-derived identity this is also the rung that makes "one finding
    //    per problem per project" hold across TICKS and not merely across a
    //    replay: a later tick re-deriving the same signature lands here.
    const existing = await findings.findBySignature(lane.projectId, identity.signature);
    if (existing !== null) {
      deps.logger.info(
        `analysis tick: candidate ${identity.signature} was already written up by an earlier run, so this tick left it alone`,
      );
      return { capExhausted: false, action: { kind: "reuse" } };
    }

    // The claim stands but no finding does — a run that stopped between the two.
    // The budget is gone and may not be re-spent, so the finding lands at the
    // floor. `floor_model_call_failed` is the honest member: a written
    // explanation was attempted for this candidate and did not complete. The
    // model id is unknown to us — the attempt was another run's, and inventing
    // an id would attribute text to a model nobody can vouch for.
    deps.logger.error(
      `analysis tick: candidate ${identity.signature} was claimed by an earlier run that recorded no finding, so it is being written up without one`,
    );
    return floorPlanFor("floor_model_call_failed", NO_CALL);
  }

  // ── RUNG 5: THE CALL. The claim is spent from here on, whatever happens.
  let result: SummaryRenderResult;
  try {
    result = await summariser.port.render(summariseInputFor(candidate));
  } catch (error) {
    // The port is CONTRACTED never to throw — it degrades by return value. A
    // port somebody breaks anyway must not become a run stuck `running`, and
    // must not cost the finding: the candidate falls to the floor exactly as a
    // returned `call_failed` would. The thrown text is OURS to log and never
    // the customer's to read.
    deps.logger.error(
      `analysis tick: candidate ${identity.signature} threw while being written up — ${describeError(error)}`,
    );
    return floorPlanFor("floor_model_call_failed", {
      attempted: true,
      // ATTRIBUTED, even here. A throw loses the RESULT, not the knowledge of
      // which model was addressed — the composition root resolved that id and
      // handed it over beside the port, so this path records the same id every
      // other attempt does. Writing `null` instead would make an attempted call
      // indistinguishable from one that was never made, on two columns whose
      // headers promise otherwise (AD-5).
      resolvedModelId: summariser.resolvedModelId,
      usage: {},
    });
  }

  const attribution: CallAttribution = {
    attempted: true,
    resolvedModelId: result.resolvedModelId,
    usage: result.usage,
  };

  if (!result.ok) {
    // The port's two mechanisms, kept apart all the way to the persisted row:
    // a shape failure is not a transport failure, and a customer reading either
    // sentence is told something true about which one happened.
    const source: FloorSummarySource =
      result.code === "output_invalid" ? "floor_model_output_invalid" : "floor_model_call_failed";
    deps.logger.info(
      `analysis tick: candidate ${identity.signature} has no written explanation — ${result.message}`,
    );
    return floorPlanFor(source, attribution);
  }

  // ── RUNG 6: THE SHAPE. Re-parsed HERE, against the same schema the adapter
  //    was handed, because what came back is external data (D5) and the
  //    `ok:true` arm's `headline`/`context` are only `z.string()`. An empty
  //    headline is a shape failure, not text for the guard to judge.
  const parsed = modelSummaryOutputSchema.safeParse({
    headline: result.headline,
    context: result.context,
  });
  if (!parsed.success) {
    deps.logger.info(
      `analysis tick: candidate ${identity.signature} came back in a shape that could not be read as a written explanation`,
    );
    return floorPlanFor("floor_model_output_invalid", attribution);
  }

  // ── RUNG 7: THE SAC GUARD, over the text AS IT WILL BE PERSISTED.
  //    Segmented first, so the array stored below is the very array judged; the
  //    guard is handed the join of those sentences and nothing else. Prose no
  //    honest segmentation exists for is itself a rejection (AD-7) — unjudged
  //    text does not reach a customer.
  const sentences = splitSentences(parsed.data.context);
  if (sentences === null) {
    deps.logger.info(
      `analysis tick: candidate ${identity.signature} came back as prose that could not be checked one sentence at a time, so it was left out`,
    );
    return floorPlanFor("floor_model_text_rejected", attribution);
  }

  const verdict = guardModelText({
    candidate,
    headline: parsed.data.headline,
    context: joinSentences(sentences),
  });
  if (!verdict.ok) {
    // THE RULE AND THE POSITION, NEVER THE TEXT. The offending string carries a
    // customer's page path and their counts; the rule id and the element index
    // are enough to find it and are facts about this code rather than about
    // somebody's product (AD-7).
    const offences = verdict.offences
      .map((offence) => `${offence.sac}@${String(offence.element)}`)
      .join(", ");
    deps.logger.info(
      `analysis tick: candidate ${identity.signature} had a written explanation that did not pass the accuracy check (${verdict.refusal}${offences === "" ? "" : `: ${offences}`}), so it was left out`,
    );
    return floorPlanFor("floor_model_text_rejected", attribution);
  }

  // ── RUNG 8: MODEL RENDERED. The headline as the model wrote it, the context
  //    as the guard judged it, sentence by sentence.
  return {
    capExhausted: false,
    action: {
      kind: "persist",
      identity,
      summary: {
        summarySource: "model_rendered",
        headline: parsed.data.headline,
        context: sentences,
        attribution,
      },
    },
  };
}

/**
 * Records the finding's identity on O-006's ledger, as a SIDE EFFECT (AD-1).
 *
 * Isolated in its own try/catch and never propagated: the finding is the main
 * flow and this write is not (D8). A missed record surfaces later as an
 * identity that may be delivered again — recoverable — where a propagated
 * failure would cost the run every candidate after this one.
 *
 * `recordSignature` is the ONLY ledger entry point this lane may call, and it
 * shares the signature's ONE producer with `identityFor` above — the service
 * composes `signatureTuple` and `sha256Hex` itself, `identityFor` calls that
 * same `computeFindingSignature`, and neither re-implements the hash. The row
 * this lane just persisted and the ledger row written here therefore carry the
 * SAME signature by construction rather than by two derivations agreeing.
 *
 * `signature` is passed in only so the log line can name the identity the
 * failure is about — nothing here derives it a second time.
 */
async function recordIdentity(
  ledger: SignatureLedgerService,
  lane: AnalysisLane,
  candidate: CandidateFinding,
  signature: string,
  logger: AnalysisLogger,
): Promise<void> {
  try {
    await ledger.recordSignature(lane.projectId, candidate);
  } catch (error) {
    logger.error(
      `analysis tick: candidate ${signature} was recorded as a finding but its identity could not be filed — ${describeError(error)}`,
    );
  }
}

/** What the run row will say when it closes. Mutated as candidates are
 * processed, so every exit path — ordinary, refused or thrown — closes from one
 * accumulated set of facts rather than from a value some branch forgot to set. */
type RunTally = {
  modelCallsAttempted: number;
  resolvedModelId: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  findingsPersisted: number;
  unrenderable: number;
  refused: number;
  capExhausted: boolean;
};

function newTally(): RunTally {
  return {
    modelCallsAttempted: 0,
    resolvedModelId: null,
    // NULL MEANS NOT REPORTED, never `0` (FR-M9). A run whose calls all went
    // unmetered must not read as a run that cost nothing, so a token total only
    // becomes a number once something reported one.
    tokensIn: null,
    tokensOut: null,
    findingsPersisted: 0,
    unrenderable: 0,
    refused: 0,
    capExhausted: false,
  };
}

function addReported(total: number | null, reported: number | undefined): number | null {
  if (reported === undefined) return total;
  return (total ?? 0) + reported;
}

function applyAttribution(tally: RunTally, attribution: CallAttribution): void {
  if (!attribution.attempted) return;
  tally.modelCallsAttempted += 1;
  // The first model actually addressed. `null` on a closed run therefore means
  // no call was attempted AT ALL — never that one was attempted and failed
  // (AD-5, `shared/src/summary/types.ts:173-182`). That holds because
  // `CallAttribution`'s `attempted: true` arm cannot carry a null id: this
  // aggregate is only as true as its inputs, and a run whose every call threw
  // used to close with `modelCallsAttempted > 0` beside a null model id.
  tally.resolvedModelId ??= attribution.resolvedModelId;
  tally.tokensIn = addReported(tally.tokensIn, attribution.usage.inputTokens);
  tally.tokensOut = addReported(tally.tokensOut, attribution.usage.outputTokens);
}

/**
 * What a completed run FOUND — read off facts, never guessed.
 *
 * The two zeros stay distinct (`shared/src/summary/types.ts:44-62`): "we have
 * not looked yet" and "we looked and your product was quiet" are different
 * answers, and only the lane source knows which applies.
 *
 * On a FAILED run this answers `produced_findings` whenever the lane had
 * candidates at all, including when none of them landed. That direction is
 * deliberate: a run that broke must never report the shape of an empty product,
 * because "we could not finish" read as "there was nothing to find" is the same
 * false reassurance SAC-10 exists to prevent one level up.
 */
function outcomeFor(lane: AnalysisLane): AnalysisOutcome {
  if (lane.candidates.length > 0) return "produced_findings";
  return lane.sessionsConsidered > 0 ? "no_candidates_passed_gate" : "no_sessions_to_analyse";
}

/**
 * The terminal write (D8). NEVER throws: this is the last thing standing
 * between a lane and a row left `running`, and a run left `running` makes every
 * future run for that project un-openable behind the partial unique index. A
 * fault here is logged loudly rather than propagated, which would leave the row
 * exactly as stuck AND lose the log line.
 */
async function closeRun(
  deps: AnalysisTickDeps,
  runs: AnalysisRunsRepo,
  lane: AnalysisLane,
  run: AnalysisRunRecord,
  tally: RunTally,
  status: "completed" | "failed",
  stopReason: AnalysisStopReason,
): Promise<void> {
  try {
    await runs.close({
      runId: run.id,
      projectId: lane.projectId,
      status,
      outcome: outcomeFor(lane),
      stopReason,
      finishedAt: deps.now(),
      modelCallsAttempted: tally.modelCallsAttempted,
      // THE CANDIDATES THAT PRODUCED NO FINDING, MADE DURABLE. Counted in
      // memory during the walk and written here, because a tally that dies with
      // the process leaves a run reporting `produced_findings` /
      // `ran_to_completion` over zero rows — "we lost some" decaying into "we
      // checked everything", which is SAC-10's shape one level down. No floor
      // sentence is invented for them: the count is the fact, and the refusal
      // to phrase what could not honestly be phrased stands.
      candidatesUnrenderable: tally.unrenderable,
      candidatesRefused: tally.refused,
      resolvedModelId: tally.resolvedModelId,
      tokensIn: tally.tokensIn,
      tokensOut: tally.tokensOut,
      // Plain English on a failure, and NOTHING on a success — a sentence on a
      // completed run would be a claim about a problem that did not happen.
      failureReason: status === "failed" ? CHECK_DID_NOT_FINISH : null,
    });
  } catch (error) {
    // NOT "this may block the next check" — that was true before the lease
    // landed. `analysis_runs` now hands a `running` row back to the next tick
    // once it is older than `ANALYSIS_RUN_LEASE_MS` (45 minutes, deliberately
    // shorter than this task's hourly cron), which closes it `failed` and
    // reopens the lane. So the cost of this fault is bounded and known: this
    // run's own verdict is lost, and the row reads as an abandoned run rather
    // than as what actually happened.
    deps.logger.error(
      `analysis tick: project ${lane.projectId} finished but its run could not be closed, so this check's own record of what it did is lost and a later check will reclaim the run as abandoned — ${describeError(error)}`,
    );
  }
}

/**
 * One project's turn.
 *
 * Returns an outcome on every path. The run is opened FIRST and closed on every
 * path out of a successful open — including the one where a candidate's
 * persistence fails, which ends the lane rather than continuing against a store
 * that has stopped answering.
 */
async function runLane(
  deps: AnalysisTickDeps,
  summary: AnalysisTickSummary,
  lane: AnalysisLane,
  tickAt: Date,
): Promise<LaneOutcome> {
  const ctx = tenantContextFor(lane);
  const findings = deps.findingsFor(ctx);
  const runs = deps.runsFor(ctx);
  const ledger = deps.ledgerFor(ctx);

  const opened = await runs.open({ projectId: lane.projectId, tickAt });

  if (!opened.opened) {
    // A run for this project is already open. The partial unique index refused
    // ours, and that refusal IS the single-writer guarantee the cap's count
    // subquery rests on — two runs sharing one project would each believe there
    // was budget. So this tick does NOTHING: no candidates, no claims, and
    // above all no terminal write, which would stamp our outcome onto a run
    // somebody else is still working.
    deps.logger.info(
      `analysis tick: project ${lane.projectId} is already being checked by another run, so this tick left it alone`,
    );
    return "already_running";
  }

  const run = opened.run;
  const tally = newTally();

  try {
    // ONE AT A TIME, IN THE SOURCE'S ORDER. Never `Promise.all`: the cap is
    // spent in order, and a lane whose budget went to whichever candidate
    // resolved first would answer differently on every run for one input.
    //
    // The position is carried for LOG LINES ONLY (see `surfaceIsSafeToSend`) —
    // it names which candidate of this walk a refusal is about, at a point where
    // no safe stable identifier exists yet, and it is 1-based because a person
    // reads it. Nothing keys on it: a candidate's position is exactly the churny
    // input AD-20 removed from its identity.
    for (const [index, candidate] of lane.candidates.entries()) {
      const plan = await planCandidate(
        deps,
        lane,
        runs,
        findings,
        run,
        candidate,
        index + 1,
        tickAt,
      );

      // RECORDED BEFORE ANYTHING ELSE CAN GO WRONG. A spent cap is a fact about
      // the claim, and it must survive a floor refusal, a store failure, or
      // anything else downstream — "we stopped early" may never decay into "we
      // checked everything there was to check" (SAC-10).
      if (plan.capExhausted) tally.capExhausted = true;

      if (plan.action.kind === "reuse") {
        tally.findingsPersisted += 1;
        continue;
      }

      if (plan.action.kind === "refused") {
        // Already logged by `surfaceIsSafeToSend` or by `identityFor`. Counted,
        // never silent — and it does NOT fail the run: one candidate the gate
        // refused, or one whose identity could not be minted, must not cost this
        // project every other candidate (D8 isolation). Kept apart from
        // `unrenderable` all the way to the tick summary.
        tally.refused += 1;
        continue;
      }

      if (plan.action.kind === "unrenderable") {
        // Already logged by `floorTextFor`. Counted, never silent — and it does
        // NOT fail the run: one candidate the floor refused must not cost this
        // project every other candidate (D8 isolation).
        tally.unrenderable += 1;
        continue;
      }

      const rendered = plan.action.summary;
      const identity = plan.action.identity;
      applyAttribution(tally, rendered.attribution);

      // ONE INSERT AGAINST THE UNIQUE `(org, project, signature)` — never a
      // check-then-write. A replay conflicts and reads back the row it already
      // wrote, which is what makes retry safety a property of this statement
      // rather than of the order the candidates happened to arrive in (D4). The
      // signature is the one the claim above was taken on, carried on the plan
      // and not re-derived here.
      await findings.persist({
        projectId: lane.projectId,
        runId: run.id,
        signature: identity.signature,
        signatureVersion: identity.signatureVersion,
        summarySource: rendered.summarySource,
        headline: rendered.headline,
        context: rendered.context,
        finalClass: candidate.finalClass,
        surface: candidate.surface,
        // COPIED, NOT SUBSTITUTED. The column is nullable and the candidate's
        // own `null` means "no normaliser version was recorded" — a fact, and
        // one this file must not overwrite. It previously wrote `0` there,
        // which the candidate contract allows a producer to emit as a REAL
        // version (`core/src/findings/candidate.ts:93` is `.nullable()` and not
        // `.positive()`), so absence and v0 became one stored value on a column
        // that feeds D12 identity comparisons.
        surfaceNormalisationVersion: candidate.surfaceNormalisationVersion,
        counts: toCountRows(candidate),
        confidenceBasis: candidate.ranking.confidenceBasis,
        windowStart: candidate.timeframe.start,
        windowEnd: candidate.timeframe.end,
        evidenceShape: candidate.evidenceShape,
        evidenceShapeVersion: candidate.evidenceShapeVersion,
        resolvedModelId: rendered.attribution.resolvedModelId,
        // `?? null` — NEVER `?? 0`. A candidate the model touched but did not
        // meter must not look identical to one that cost nothing (FR-M9).
        tokensIn: rendered.attribution.usage.inputTokens ?? null,
        tokensOut: rendered.attribution.usage.outputTokens ?? null,
      });

      tally.findingsPersisted += 1;

      // AFTER the finding is durable, and isolated from it (AD-1, D8).
      await recordIdentity(ledger, lane, candidate, identity.signature, deps.logger);
    }
  } catch (error) {
    // A candidate's write, a claim, or a reuse read failed mid-run. The work
    // already done STANDS — a half-run that rolled back its earlier findings
    // would lose them to a fault that had nothing to do with them — and the run
    // is closed `failed` so it cannot jam this project's lane.
    deps.logger.error(
      `analysis tick: project ${lane.projectId} could not finish its check — ${describeError(error)}`,
    );
    await closeRun(deps, runs, lane, run, tally, "failed", "fatal_error");
    summary.findingsPersisted += tally.findingsPersisted;
    summary.candidatesUnrenderable += tally.unrenderable;
    summary.candidatesRefused += tally.refused;
    summary.modelCallsAttempted += tally.modelCallsAttempted;
    return "failed";
  }

  // A SPENT CAP IS NOT A FAILURE AND NOT AN EMPTY ANSWER. The run completed and
  // every candidate was reported; `cap_exhausted` says only that the ones past
  // the limit have no written explanation (SAC-10).
  await closeRun(
    deps,
    runs,
    lane,
    run,
    tally,
    "completed",
    tally.capExhausted ? "cap_exhausted" : "ran_to_completion",
  );

  summary.findingsPersisted += tally.findingsPersisted;
  summary.candidatesUnrenderable += tally.unrenderable;
  summary.candidatesRefused += tally.refused;
  summary.modelCallsAttempted += tally.modelCallsAttempted;
  return "completed";
}

/**
 * Open, walk the ladder, persist, close — once per due project.
 *
 * A tick with no due lanes is a CLEAN NO-OP: no crash, no error state, and
 * nothing recorded. An installation with no project connected, or none with
 * enough activity to look at, is a supported deployment (the self-host
 * graceful-absence promise), and recording something here would make "nothing
 * is attached" indistinguishable from "we looked and there was nothing" — the
 * one distinction this lane's whole vocabulary exists to keep.
 *
 * The lane READ is deliberately outside the isolation: if the source itself
 * fails there are no lanes to isolate from each other, and letting it throw is
 * what makes Graphile Worker retry the tick rather than record a healthy-looking
 * run over a read that never happened.
 */
export async function runAnalysisTick(deps: AnalysisTickDeps): Promise<AnalysisTickSummary> {
  const tickAt = deps.now();
  const lanes = await deps.lanes.listDueLanes(tickAt);

  const summary: AnalysisTickSummary = {
    lanesConsidered: lanes.length,
    lanesRun: 0,
    lanesAlreadyRunning: 0,
    lanesFailed: 0,
    lanesErrored: 0,
    findingsPersisted: 0,
    candidatesUnrenderable: 0,
    candidatesRefused: 0,
    modelCallsAttempted: 0,
  };

  if (lanes.length === 0) {
    return summary;
  }

  for (const lane of lanes) {
    try {
      const outcome = await runLane(deps, summary, lane, tickAt);
      if (outcome === "completed") summary.lanesRun += 1;
      if (outcome === "failed") {
        summary.lanesRun += 1;
        summary.lanesFailed += 1;
      }
      if (outcome === "already_running") summary.lanesAlreadyRunning += 1;
    } catch (error) {
      // PER-LANE ISOLATION (D8). One project's fault — a context that will not
      // build, a repository factory that throws, a run that cannot be opened —
      // cannot cost every other project its check. The loop continues, and the
      // next project is analysed.
      deps.logger.error(
        `analysis tick: project ${lane.projectId} could not be processed — ${describeError(error)}`,
      );
      summary.lanesErrored += 1;
    }
  }

  deps.logger.info(
    // `modelCallsAttempted` counts ATTEMPTS, not successes: a call that failed,
    // came back unreadable or was refused by the accuracy check is counted here
    // and was not written up. Labelling it "written up" overstated every one of
    // those, on the one line a reader uses to see what a tick did.
    `analysis tick: lanes ${String(summary.lanesConsidered)}, checked ${String(summary.lanesRun)} (${String(summary.lanesFailed)} did not finish), already running ${String(summary.lanesAlreadyRunning)}, errored ${String(summary.lanesErrored)}, findings ${String(summary.findingsPersisted)}, asked a model to write up ${String(summary.modelCallsAttempted)}, not written up at all ${String(summary.candidatesUnrenderable)}, turned away before we looked at them ${String(summary.candidatesRefused)}`,
  );

  return summary;
}
