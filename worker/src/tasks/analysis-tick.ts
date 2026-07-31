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
 * row is a close that itself fails, and that one is logged loudly.
 *
 * ── THE CAP'S EXHAUSTION IS A NAMED STATE, NEVER SILENCE (SAC-10) ───────────
 * Past the cap, candidates are still persisted — under `floor_cap_exhausted` —
 * and the run records `stop_reason = cap_exhausted`. Dropping them would make
 * "we stopped early" indistinguishable from "there was nothing more to find",
 * which would tell a founder their product is quieter than it is.
 *
 * ── IDEMPOTENCY IS STRUCTURAL, NOT REMEMBERED (D4/D6) ───────────────────────
 * Two mechanisms, neither of which is a check-then-write: `claimModelCall` is
 * one conditional insert against a unique `(org, project, candidate_key)`, and
 * `persist` is one insert against the same tuple on `findings`. A Graphile
 * Worker replay of this task therefore conflicts on both and re-calls no model
 * and mints no second finding.
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
  splitSentences,
} from "@growthmind/core";
import type {
  AnalysisRunRecord,
  AnalysisRunsRepo,
  FindingsRepo,
  MeasuredCountRow,
  SignatureLedgerService,
} from "@growthmind/db";
import type {
  AnalysisOutcome,
  AnalysisStopReason,
  SummaryRenderResult,
  SummarySource,
  SummaryUsage,
  TenantContext,
} from "@growthmind/shared";
import { ANALYSIS_RUN_STATUS_MESSAGES, tenantContextSchema } from "@growthmind/shared";

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
 * A NAMESPACED SENTINEL, not a fake user id — the device
 * `packages/db/src/system/system-context.ts` and `./delivery-tick.ts` both use.
 * It cannot collide with a Better Auth user id, and it says who acted in any
 * log line or future audit row without anyone having to look it up.
 */
export const ANALYSIS_ACTOR_ID = "system:analysis-tick";

/** The role stamped on a system context, so a future audit surface can tell a
 * scheduled write from a human one without parsing the actor id. */
export const ANALYSIS_ACTOR_ROLE = "system";

/**
 * One gate-passed candidate, with the lane's own handle on it.
 *
 * `candidateKey` is SUPPLIED BY THE LANE and computed nowhere in this sprint
 * (AD-13, D12). It is a retry/dedup handle scoped to
 * `(organization_id, project_id)` — it carries none of the never-deliver-twice
 * or dismissed-forever guarantees, all of which live on O-006's signature
 * ledger. Deriving one here would mint a second computed identity whose inputs
 * nobody keeps stable, which is the exact fork D12 exists to prevent.
 */
export type AnalysisCandidate = {
  readonly candidateKey: string;
  readonly candidate: CandidateFinding;
};

/**
 * One project's analysis lane, as the source read it.
 *
 * `candidates` is in the source's DETERMINISTIC ORDER and is processed in that
 * order, one at a time. Cap exhaustion is only reproducible because it is: a
 * lane that spent its budget on whichever candidates a `Promise.all` happened
 * to resolve first would give a different answer on every run for the same
 * input (ADD §7.5, pinned by W7).
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
  readonly candidates: readonly AnalysisCandidate[];
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

export interface AnalysisTickDeps {
  lanes: AnalysisLaneSource;
  /** `null` ⇒ no written-explanation capability is configured on this
   * installation. THE BRANCH, selected at the composition root (AD-15) — this
   * file reads no environment variable by any route, and a null here is a
   * decision rather than a caught failure. */
  summariser: SessionSummariser | null;
  findingsFor: FindingsRepoFor;
  runsFor: AnalysisRunsRepoFor;
  ledgerFor: SignatureLedgerFor;
  /** The per-project first-check limit on written explanations. Passed in from
   * `./analysis-cap.ts` by the composition root; policy never leaks into
   * `packages/db`, whose claim takes `cap` as a parameter. */
  cap: number;
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
   * model lane — see `floorTextFor`. */
  candidatesUnrenderable: number;
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
 * and `usage` may be reported on either. `attempted` is the field that decides
 * whether a `null` model id means "no call was made" or "a call was made and
 * the port could not tell us which model it reached".
 */
type CallAttribution = {
  readonly attempted: boolean;
  readonly resolvedModelId: string | null;
  readonly usage: SummaryUsage;
};

/** No call was made at all: the no-key rung, and the cap-refused rung. */
const NO_CALL: CallAttribution = { attempted: false, resolvedModelId: null, usage: {} };

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
  | { readonly kind: "persist"; readonly summary: RenderedSummary }
  | { readonly kind: "reuse" }
  | { readonly kind: "unrenderable" };

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

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Builds the `TenantContext` this lane's writes run as, from the lane row
 * itself. Parsed through the SAME schema a request-derived context is, rather
 * than returned as a bare literal: there is one accepted context shape, and the
 * scheduled path is held to it too (D7).
 */
function tenantContextFor(lane: AnalysisLane): TenantContext {
  return tenantContextSchema.parse({
    userId: ANALYSIS_ACTOR_ID,
    organizationId: lane.organizationId,
    organizationName: lane.organizationName,
    role: ANALYSIS_ACTOR_ROLE,
  });
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
 * THE MESSAGE NAMES THE CANDIDATE KEY AND THE CAUSE, NEVER THE CANDIDATE. A
 * refusal's own text can name a page path or a count, and neither is a fact
 * about this codebase — the same discipline as `floor.ts:126-129`.
 */
function floorTextFor(
  candidateKey: string,
  candidate: CandidateFinding,
  source: FloorSummarySource,
  logger: AnalysisLogger,
): FloorSummary | null {
  try {
    return renderFloorSummary({ candidate, source });
  } catch (error) {
    logger.error(
      `analysis tick: candidate ${candidateKey} could not be written up even without a model, so nothing was recorded for it — ${describeError(error)}`,
    );
    return null;
  }
}

/** One floor rung, assembled. `floor.source` is carried through exactly as the
 * renderer returned it — this never re-states the cause it asked for. */
function floorAction(floor: FloorSummary, attribution: CallAttribution): CandidateAction {
  return {
    kind: "persist",
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
  item: AnalysisCandidate,
  tickAt: Date,
): Promise<CandidatePlan> {
  const { candidate, candidateKey } = item;

  const floorPlanFor = (
    source: FloorSummarySource,
    attribution: CallAttribution,
    capExhausted = false,
  ): CandidatePlan => {
    const floor = floorTextFor(candidateKey, candidate, source, deps.logger);
    return {
      capExhausted,
      action: floor === null ? { kind: "unrenderable" } : floorAction(floor, attribution),
    };
  };

  // ── RUNG 1: NO KEY. The branch SELECTS this lane (AD-15); it does not try a
  //    port and swallow the failure. Zero claims and zero calls follow from the
  //    key check standing BEFORE the claim, and from nothing else.
  if (deps.summariser === null) {
    return floorPlanFor("floor_no_key_configured", NO_CALL);
  }

  // ── RUNG 2: THE CAP CLAIM. One conditional insert, NO prior read (D6). The
  //    count predicate and the unique index are evaluated together, so two
  //    overlapping runs cannot both conclude there is budget, and its three
  //    answers stay distinguishable without a check-then-write window.
  const claim = await runs.claimModelCall({
    projectId: lane.projectId,
    runId: run.id,
    candidateKey,
    cap: deps.cap,
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
    //    read, so this rung makes NO call under any circumstance.
    const existing = await findings.findByCandidateKey(lane.projectId, candidateKey);
    if (existing !== null) {
      deps.logger.info(
        `analysis tick: candidate ${candidateKey} was already written up by an earlier run, so this tick left it alone`,
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
      `analysis tick: candidate ${candidateKey} was claimed by an earlier run that recorded no finding, so it is being written up without one`,
    );
    return floorPlanFor("floor_model_call_failed", NO_CALL);
  }

  // ── RUNG 5: THE CALL. The claim is spent from here on, whatever happens.
  let result: SummaryRenderResult;
  try {
    result = await deps.summariser.render(summariseInputFor(candidate));
  } catch (error) {
    // The port is CONTRACTED never to throw — it degrades by return value. A
    // port somebody breaks anyway must not become a run stuck `running`, and
    // must not cost the finding: the candidate falls to the floor exactly as a
    // returned `call_failed` would. The thrown text is OURS to log and never
    // the customer's to read.
    deps.logger.error(
      `analysis tick: candidate ${candidateKey} threw while being written up — ${describeError(error)}`,
    );
    return floorPlanFor("floor_model_call_failed", {
      attempted: true,
      // No result means no model id. This is the ONE path where `null` does not
      // mean "no call was attempted"; the attempt itself is recorded on the
      // claim row in `analysis_model_calls`, which is its home.
      resolvedModelId: null,
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
      `analysis tick: candidate ${candidateKey} has no written explanation — ${result.message}`,
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
      `analysis tick: candidate ${candidateKey} came back in a shape that could not be read as a written explanation`,
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
      `analysis tick: candidate ${candidateKey} came back as prose that could not be checked one sentence at a time, so it was left out`,
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
      `analysis tick: candidate ${candidateKey} had a written explanation that did not pass the accuracy check (${verdict.refusal}${offences === "" ? "" : `: ${offences}`}), so it was left out`,
    );
    return floorPlanFor("floor_model_text_rejected", attribution);
  }

  // ── RUNG 8: MODEL RENDERED. The headline as the model wrote it, the context
  //    as the guard judged it, sentence by sentence.
  return {
    capExhausted: false,
    action: {
      kind: "persist",
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
 * `recordSignature` is the ONLY ledger entry point this lane may call, and the
 * ONLY producer of a signature (FR-I(e)). Nothing here hashes anything: the
 * service composes `signatureTuple` and `sha256Hex` itself, and a second
 * implementation of that composition is exactly the fork D12 names.
 */
async function recordIdentity(
  ledger: SignatureLedgerService,
  lane: AnalysisLane,
  item: AnalysisCandidate,
  logger: AnalysisLogger,
): Promise<void> {
  try {
    await ledger.recordSignature(lane.projectId, item.candidate);
  } catch (error) {
    logger.error(
      `analysis tick: candidate ${item.candidateKey} was recorded as a finding but its identity could not be filed — ${describeError(error)}`,
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
  // (AD-5, `shared/src/summary/types.ts:173-182`).
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
      resolvedModelId: tally.resolvedModelId,
      tokensIn: tally.tokensIn,
      tokensOut: tally.tokensOut,
      // Plain English on a failure, and NOTHING on a success — a sentence on a
      // completed run would be a claim about a problem that did not happen.
      failureReason: status === "failed" ? CHECK_DID_NOT_FINISH : null,
    });
  } catch (error) {
    deps.logger.error(
      `analysis tick: project ${lane.projectId} finished but its run could not be closed, so it may block the next check — ${describeError(error)}`,
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
    for (const item of lane.candidates) {
      const plan = await planCandidate(deps, lane, runs, findings, run, item, tickAt);

      // RECORDED BEFORE ANYTHING ELSE CAN GO WRONG. A spent cap is a fact about
      // the claim, and it must survive a floor refusal, a store failure, or
      // anything else downstream — "we stopped early" may never decay into "we
      // checked everything there was to check" (SAC-10).
      if (plan.capExhausted) tally.capExhausted = true;

      if (plan.action.kind === "reuse") {
        tally.findingsPersisted += 1;
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
      applyAttribution(tally, rendered.attribution);

      // ONE INSERT AGAINST THE UNIQUE `(org, project, candidate_key)` — never a
      // check-then-write. A replay conflicts and reads back the row it already
      // wrote, which is what makes retry safety a property of this statement
      // rather than of the order the candidates happened to arrive in (D4).
      await findings.persist({
        projectId: lane.projectId,
        runId: run.id,
        candidateKey: item.candidateKey,
        summarySource: rendered.summarySource,
        headline: rendered.headline,
        context: rendered.context,
        finalClass: item.candidate.finalClass,
        surface: item.candidate.surface,
        surfaceNormalisationVersion: surfaceNormalisationVersionFor(item, deps.logger),
        counts: toCountRows(item.candidate),
        confidenceBasis: item.candidate.ranking.confidenceBasis,
        windowStart: item.candidate.timeframe.start,
        windowEnd: item.candidate.timeframe.end,
        evidenceShape: item.candidate.evidenceShape,
        evidenceShapeVersion: item.candidate.evidenceShapeVersion,
        resolvedModelId: rendered.attribution.resolvedModelId,
        // `?? null` — NEVER `?? 0`. A candidate the model touched but did not
        // meter must not look identical to one that cost nothing (FR-M9).
        tokensIn: rendered.attribution.usage.inputTokens ?? null,
        tokensOut: rendered.attribution.usage.outputTokens ?? null,
      });

      tally.findingsPersisted += 1;

      // AFTER the finding is durable, and isolated from it (AD-1, D8).
      await recordIdentity(ledger, lane, item, deps.logger);
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
  summary.modelCallsAttempted += tally.modelCallsAttempted;
  return "completed";
}

/**
 * `findings.surface_normalisation_version` is NOT NULL, while a candidate may
 * carry `null` there — "a row written before versions were recorded"
 * (`core/src/findings/candidate.ts:92`). The two cannot both be honoured, so
 * this states which and why, in one place.
 *
 * `0` is the persisted spelling of "no normaliser version was recorded". It is
 * deliberately NOT `URL_PATH_NORMALISATION_VERSION`: claiming the current
 * normaliser produced a surface nobody recorded a version for would assert a
 * fact this code cannot establish, and that assertion would then be baked into
 * every later comparison a version exists to make possible (D12). Dropping the
 * finding instead was the other option and is worse — the version is provenance
 * about the surface, not part of the claim, and no finding should be lost over
 * it.
 *
 * TODO(the corpus-reader heir of ADD AD-0): make the column nullable and delete
 * this function. The heir is the first producer that can actually emit a null,
 * and it is the migration's natural owner.
 */
function surfaceNormalisationVersionFor(item: AnalysisCandidate, logger: AnalysisLogger): number {
  const version = item.candidate.surfaceNormalisationVersion;
  if (version !== null) return version;

  logger.info(
    `analysis tick: candidate ${item.candidateKey} carries no record of which path normaliser produced its surface`,
  );
  return 0;
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
    `analysis tick: lanes ${String(summary.lanesConsidered)}, checked ${String(summary.lanesRun)} (${String(summary.lanesFailed)} did not finish), already running ${String(summary.lanesAlreadyRunning)}, errored ${String(summary.lanesErrored)}, findings ${String(summary.findingsPersisted)}, written up ${String(summary.modelCallsAttempted)}, not written up at all ${String(summary.candidatesUnrenderable)}`,
  );

  return summary;
}
