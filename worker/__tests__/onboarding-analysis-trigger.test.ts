// O-008 Wave 0e, task 0e.1 — THE ONBOARDING ANALYSIS TRIGGER. ADD §9, 16 rows
// (13 lane-reuse + 3 fail-direction). AD-9, AD-10, AD-12, FR-O16, FR-O17.
//
// ###########################################################################
// # R-AD9 — THE SHAPE OF THE GUARANTEE, AND WHY IT IS NOT A CHECKLIST ITEM.
// #
// # FR-O17 says the fast path "respects the single-writer index AND the cap
// # ledger, or it does not ship", and names a cap-bypassing trigger a
// # FINANCIAL COMMITMENT and an Always-Check-With-Tom item. The strongest
// # available guarantee is therefore NOT a row asserting the trigger calls
// # `claimModelCall` correctly — it is that THE TRIGGER HAS NO MODEL-CALL
// # SITE OF ITS OWN TO GET WRONG.
// #
// # `runAnalysisLane` is the code that opens the run against
// # `analysis_runs_one_open_per_project_key`, claims through `claimModelCall`
// # under BOTH ceilings, walks the eight-rung degradation ladder, and closes
// # the run terminally on every exit path. The onboarding task contributes a
// # project id and nothing else. So the rows below pin the STRUCTURE (row 1's
// # source scan) and then drive the BEHAVIOUR through it — a suite that only
// # checked the behaviour would stay green against a second pipeline that
// # happened to claim correctly today and drifted next sprint.
// ###########################################################################
//
// D10 FRAMING (the fail-direction block). The trigger is a deterministic
// pre-model gate deciding whether analysis happens NOW or WITHIN THE HOUR. The
// taxonomy's question is never "will it miss" — it will — but WHICH WAY it
// fails. It must fail toward the hourly cron, never toward silence.
//
// TWO STANDING BANNED-ROW RULES ARE OBSERVED HERE (ADD §9):
//   1. NOTHING BELOW ASSERTS THAT A FAILED ONBOARDING JOB IS RETRIED. Wave 0a
//      measured it: a second trigger for the same project forces the in-flight
//      job's `attempts` to `max_attempts`, so a subsequent failure is
//      PERMANENT, not retried. The work is carried by the replacement job and
//      by the hourly cron; the retry is not. A row asserting retry would be
//      false in the common case.
//   2. THE PAYLOAD SCHEMA'S REFUSAL IS NEVER VERIFIED BY KEY ENUMERATION
//      ALONE. `Object.keys(shape)` is identical for `z.object` and
//      `z.strictObject`, so row 4's enumeration is PAIRED with row 5's
//      behavioural refusal. Neither row stands on its own.
//
// WHAT IS RED TODAY AND WHY. `worker/src/tasks/onboarding-analysis.ts` is ADD
// Wave 3's; `runAnalysisLane` is not exported from `analysis-tick.ts` yet;
// `AnalysisLaneSource` has no `laneForProject` yet. Two different shapes of
// absence, and both are converted into NAMED diagnostics — an absent module by
// `loadUnderConstruction`, an absent contract on a shipped module by
// `assertUnderConstruction`. Neither a bare TS2307 nor a bare `TypeError:
// undefined is not a function` may stand in for a Wave 0 red.
//
// FIXTURE SEED PREFIX: `o008t-`. Every org name, user email and project name
// carries it plus a uuid, so this suite can never collide with another lane's
// fixtures on `user_email_unique`.
import { afterEach, beforeEach, expect, test } from "bun:test";

import {
  EVIDENCE_SHAPE_VERSION,
  GATE_REASON_MESSAGES,
  PROOF_PREDICATE_VERSION,
  THRESHOLD_RULE_SET_VERSION,
  candidateFindingSchema,
  measuredCount,
} from "@growthmind/core";
import type { CandidateFinding, MeasuredCount, TraceEntry } from "@growthmind/core";
import type {
  AnalysisRunRecord,
  AnalysisRunsRepo,
  CloseRunInput,
  FindingRecord,
  FindingsRepo,
  OpenRunResult,
  PersistFindingInput,
  RecordSignatureResult,
  SignatureLedgerService,
} from "@growthmind/db";
import { ANALYSIS_RUN_LEASE_MS, computeFindingSignature, signatureHex } from "@growthmind/db";
import { createTestDb, type TestDb } from "@growthmind/db/testing";
import type { SessionSummariser, SummariseInput } from "@growthmind/adapters";
import type { SummaryRenderResult, TenantContext } from "@growthmind/shared";

import {
  assertUnderConstruction,
  loadUnderConstruction,
  loadValueUnderConstruction,
  readSourceUnderConstruction,
  underConstructionSpecifier,
} from "../../packages/shared/__tests__/onboarding/module-under-construction";
import { COLDSTART_MODEL_CALL_CAP, ORG_MODEL_CALL_CAP } from "../src/analysis-cap";
import { createAnalysisLaneSource } from "../src/analysis-lane-source";
import type {
  AnalysisLane,
  AnalysisLaneSource,
  AnalysisLogger,
  AnalysisTickDeps,
} from "../src/tasks/analysis-tick";
import { runAnalysisTick } from "../src/tasks/analysis-tick";
import { seedPollableWorkspace } from "./helpers/wire-fixtures";

// ===========================================================================
// The owners — every red below names one of these
// ===========================================================================

const OWNER_TRIGGER = "ADD Wave 3 (worker/src/tasks/onboarding-analysis.ts, AD-11)";
const OWNER_LANE = "ADD Wave 3 (worker/src/tasks/analysis-tick.ts — export runAnalysisLane, AD-9)";
const OWNER_SOURCE = "ADD Wave 3 (worker/src/analysis-lane-source.ts — laneForProject, AD-10)";
const OWNER_POLL = "ADD Wave 3 (worker/src/tasks/session-source-poll.ts — the trigger call, AD-11)";

const TRIGGER_SOURCE_PATH = "worker/src/tasks/onboarding-analysis.ts";
const POLL_SOURCE_PATH = "worker/src/tasks/session-source-poll.ts";

// ===========================================================================
// THE CONTRACT MIRROR — declared HERE, from the ADD, never inferred from an
// implementation nobody has written (the Wave 0b/0c/0d convention).
// ===========================================================================

/** ADD AD-9, line 311 — `LaneOutcome`, copied verbatim. */
type MirrorLaneOutcome = "completed" | "failed" | "already_running";

/**
 * ADD AD-9, line 312 names `LaneTally` as "the counts `runAnalysisTick` folds
 * into its summary" WITHOUT declaring it. Derived from the four fold sites in
 * `analysis-tick.ts:1244-1247`, which are the only counts that cross the
 * boundary. FLAGGED RATHER THAN GUESSED: Wave 3 may name these fields
 * differently; it may not fold a count this list does not carry, because then
 * `runAnalysisTick`'s summary would silently lose it.
 */
type MirrorLaneTally = {
  readonly findingsPersisted: number;
  readonly unrenderable: number;
  readonly refused: number;
  readonly modelCallsAttempted: number;
};

/** ADD AD-9, lines 310-313 — copied verbatim. */
type MirrorLaneRunResult = {
  readonly outcome: MirrorLaneOutcome;
  readonly tally: MirrorLaneTally;
};

/**
 * ADD AD-9, line 316 — "`AnalysisLaneDeps`, the subset of `AnalysisTickDeps`
 * one lane actually needs".
 *
 * Written as a `Pick` over the SHIPPED `AnalysisTickDeps` rather than as eight
 * re-declared fields: every member is a type that already exists today, so
 * mirroring them by hand would invent drift where there is none. `lanes` is the
 * one member deliberately absent — a lane runner that could still reach the
 * lane SOURCE would be able to widen its own work, which is precisely the
 * "second pipeline" AD-9 exists to make impossible.
 */
type MirrorAnalysisLaneDeps = Pick<
  AnalysisTickDeps,
  | "summariser"
  | "findingsFor"
  | "runsFor"
  | "ledgerFor"
  | "projectCap"
  | "organizationCap"
  | "now"
  | "logger"
>;

/** ADD AD-9, lines 315-319 — copied verbatim. */
type MirrorRunAnalysisLane = (
  deps: MirrorAnalysisLaneDeps,
  lane: AnalysisLane,
  at: Date,
) => Promise<MirrorLaneRunResult>;

/** ADD AD-10, lines 339-345 — copied verbatim, as the widened port. */
type MirrorAnalysisLaneSource = AnalysisLaneSource & {
  laneForProject(projectId: string, now: Date): Promise<AnalysisLane | null>;
};

/**
 * The trigger's own deps. ADD §5's Wave 3 table says the task "resolves the
 * lane, calls `runAnalysisLane`, logs" — so it holds the lane SOURCE plus
 * everything one lane run needs, and nothing else.
 *
 * UNDER-SPECIFIED, FLAGGED RATHER THAN GUESSED: neither AD-11 nor §5 names this
 * type, the exported function, or the function's return value. The names below
 * follow this package's own convention (`runAnalysisTick`, `runDeliveryTick`,
 * `runSessionSourcePoll`), and EVERY ROW BELOW ASSERTS ON PERSISTED EFFECTS
 * AND LOG LINES RATHER THAN ON THE RETURN VALUE — so Wave 3 may return
 * whatever it likes without invalidating a single assertion here.
 */
type MirrorOnboardingAnalysisDeps = MirrorAnalysisLaneDeps & {
  readonly lanes: MirrorAnalysisLaneSource;
};

type MirrorRunOnboardingAnalysis = (
  deps: MirrorOnboardingAnalysisDeps,
  payload: unknown,
) => Promise<unknown>;

/** A zod schema's public surface, as much of it as these rows touch. Declared
 *  structurally so the suite needs no zod import of its own — `worker` does not
 *  depend on zod directly and adding it for a test would be a real dependency
 *  for a fake reason. */
type MirrorPayloadSchema = {
  readonly shape: Record<string, unknown>;
  safeParse(input: unknown): { success: boolean; error?: unknown };
};

// ===========================================================================
// The loaders — one per absent thing, each naming its own owner
// ===========================================================================

const loadRunOnboardingAnalysis = (): Promise<MirrorRunOnboardingAnalysis> =>
  loadUnderConstruction<MirrorRunOnboardingAnalysis>({
    modulePath: underConstructionSpecifier("worker/src/tasks/onboarding-analysis"),
    exportName: "runOnboardingAnalysis",
    ownedBy: OWNER_TRIGGER,
  });

const loadRunAnalysisLane = (): Promise<MirrorRunAnalysisLane> =>
  loadUnderConstruction<MirrorRunAnalysisLane>({
    modulePath: underConstructionSpecifier("worker/src/tasks/analysis-tick"),
    exportName: "runAnalysisLane",
    ownedBy: OWNER_LANE,
  });

const loadPayloadSchema = (): Promise<MirrorPayloadSchema> =>
  loadValueUnderConstruction<MirrorPayloadSchema>({
    modulePath: underConstructionSpecifier("worker/src/tasks/onboarding-analysis"),
    // AMENDED: this used `loadUnderConstruction`, whose comment claimed "a zod
    // schema is a callable object in zod 4". Measured against the installed
    // zod 4.4.3, that is false — `z.object`, `z.strictObject`, `.strict()`
    // chains and `z.string()` all report `typeof === "object"`, and that loader
    // hard-requires a function, so rows 4 and 5 were unpassable for any
    // implementation. `loadValueUnderConstruction` exists for exactly this
    // case (its own header names "an array, a zod object and a tuple").
    exportName: "onboardingAnalysisPayloadSchema",
    ownedBy: OWNER_TRIGGER,
  });

/**
 * The widened lane source, with the AD-10 method's presence asserted as a
 * CONTRACT rather than discovered as a `TypeError`.
 *
 * `createAnalysisLaneSource` ships today and returns an object with exactly one
 * method, so this is the second shape of absence the Wave 0e helper block
 * exists for: the module resolves, the factory runs, and the row's subject is
 * still missing.
 */
function widenedLaneSource(db: TestDb, logger: AnalysisLogger): MirrorAnalysisLaneSource {
  const source = createAnalysisLaneSource({ db, logger }) as Partial<MirrorAnalysisLaneSource>;

  assertUnderConstruction(typeof source.laneForProject === "function", {
    contract:
      "AnalysisLaneSource.laneForProject(projectId, now) — AD-10's second caller of buildLane",
    ownedBy: OWNER_SOURCE,
  });

  return source as MirrorAnalysisLaneSource;
}

// ===========================================================================
// Fixtures — the suite's one instant, and a real candidate
// ===========================================================================

const PREFIX = "o008t-";

/** The suite's ONLY instant. Every date below descends from it. */
const AT = new Date("2026-08-01T09:00:00.000Z");

const WINDOW = {
  start: new Date("2026-07-25T00:00:00.000Z"),
  end: new Date("2026-08-01T00:00:00.000Z"),
};

const ORG = "o008t-org";
const ORG_NAME = "Acme";
const PROJECT = "o008t-project";
const OTHER_PROJECT = "o008t-project-b";
const MODEL_ID = "o008t-model-under-test";

/** Wide enough that no case here can reach it accidentally — a second ceiling
 *  that could also refuse would make "the project cap refused it"
 *  unattributable, a green row for the wrong reason. */
const ORG_CAP_WIDE_ENOUGH_TO_NEVER_REFUSE = 10_000;

const CLEAN_HEADLINE = "The payment step is losing sessions";
const CLEAN_CONTEXT = "Sessions reached the payment step and left without finishing.";

function count(numerator: number, kept: number): MeasuredCount {
  return measuredCount({
    numerator,
    denominator: kept,
    unit: "sessions",
    timeframe: WINDOW,
    basis: { totalInWindow: kept, kept, setAside: [] },
  });
}

function trace(): readonly TraceEntry[] {
  return [
    {
      class: "confusing",
      predicate: "confusing_struggle",
      predicateVersion: PROOF_PREDICATE_VERSION,
      satisfied: true,
      reasonCode: "confusing_satisfied",
      reason: GATE_REASON_MESSAGES.confusing_satisfied,
    },
  ];
}

/** A real candidate, PARSED through the shipped schema — never a hand-built
 *  shape the lane could not actually produce. */
function candidate(surface: string): CandidateFinding {
  return candidateFindingSchema.parse({
    detector: "funnel_dropoff",
    claimedClass: "confusing",
    finalClass: "confusing",
    trace: trace(),
    counts: [count(28, 28), count(3, 28)],
    timeframe: WINDOW,
    claimSubject: "surface",
    surface,
    surfaceNormalisationVersion: 1,
    evidenceShape: `{"detector":"funnel_dropoff","surface":"${surface}","v":1}`,
    evidenceShapeVersion: EVIDENCE_SHAPE_VERSION,
    thresholdRuleSetVersion: THRESHOLD_RULE_SET_VERSION,
    ranking: { sampleSize: count(3, 28), confidenceBasis: "threshold_met" },
    coverage: { truncated: false, eventsWithoutUrlPath: 0 },
  });
}

const CANDIDATE_A = candidate("/checkout/payment");
const CANDIDATE_B = candidate("/checkout/review");

/** The signature the walker derives, computed through the SAME single producer
 *  it calls — so a lookup only finds a row if the walker's derivation AGREES. */
function signatureOf(projectId: string, subject: CandidateFinding): string {
  return computeFindingSignature({
    projectId,
    surface: subject.surface,
    symptomClass: subject.finalClass,
    evidenceShape: subject.evidenceShape,
  });
}

function lane(overrides: Partial<AnalysisLane> = {}): AnalysisLane {
  return {
    organizationId: ORG,
    organizationName: ORG_NAME,
    projectId: PROJECT,
    candidates: [CANDIDATE_A],
    sessionsConsidered: 42,
    ...overrides,
  };
}

// ===========================================================================
// Fakes with real state. Modelled on `tasks/analysis-tick.test.ts` and typed by
// the SHIPPED interfaces, so they cannot drift into agreeing with a repository
// that no longer exists.
//
// DELIBERATELY THIS SUITE'S OWN COPY rather than an import: that file is ADD
// Wave 3's exclusive property (§5 ownership map) and Wave 0 may not edit it, so
// extracting a shared helper out of it is not available. The fakes are typed by
// the same interfaces, which is what actually prevents drift.
// ===========================================================================

interface RecordingLogger extends AnalysisLogger {
  readonly infos: string[];
  readonly errors: string[];
}

function createRecordingLogger(): RecordingLogger {
  const infos: string[] = [];
  const errors: string[] = [];
  return {
    infos,
    errors,
    info: (message: string) => {
      infos.push(message);
    },
    error: (message: string) => {
      errors.push(message);
    },
  };
}

interface CountingSummariser {
  port: SessionSummariser;
  /** How many times a MODEL WAS ACTUALLY ADDRESSED. Row 8's whole subject. */
  calls: () => number;
}

/**
 * The summariser fake.
 *
 * ROW 8 REQUIRES THE RETRYABLE CLASS. `call_failed` is the port's transient
 * arm — the one an SDK-level retry would react to — so returning it is how this
 * fake detects a retry that slipped past the claim. A fake returning success
 * would be indistinguishable from a lane that called once and stopped, which is
 * the naive version a prior audit found and marked CRITICAL.
 */
function countingSummariser(
  behaviour: (input: SummariseInput) => Promise<SummaryRenderResult>,
): CountingSummariser {
  let seen = 0;
  return {
    calls: () => seen,
    port: {
      render(input: SummariseInput): Promise<SummaryRenderResult> {
        seen += 1;
        return behaviour(input);
      },
    },
  };
}

const retryableFailureSummariser = (): CountingSummariser =>
  countingSummariser(() =>
    Promise.resolve({
      ok: false,
      code: "call_failed",
      message: "o008t-transient",
      resolvedModelId: MODEL_ID,
      usage: {},
    }),
  );

const cleanSummariser = (): CountingSummariser =>
  countingSummariser(() =>
    Promise.resolve({
      ok: true,
      headline: CLEAN_HEADLINE,
      context: CLEAN_CONTEXT,
      resolvedModelId: MODEL_ID,
      usage: { inputTokens: 900, outputTokens: 120 },
    }),
  );

interface FakeFindings {
  repoFor: (ctx: TenantContext) => FindingsRepo;
  rows: () => FindingRecord[];
  breakOn: (signature: string) => void;
}

function findingKey(organizationId: string, projectId: string, signature: string): string {
  return `${organizationId}|${projectId}|${signature}`;
}

function createFakeFindings(): FakeFindings {
  const stored = new Map<string, FindingRecord>();
  const broken = new Set<string>();
  let nextId = 1;

  return {
    rows: () => [...stored.values()],
    breakOn: (signature) => broken.add(signature),
    repoFor: (ctx) => ({
      // `INSERT … ON CONFLICT (organization_id, project_id, signature) DO
      // NOTHING RETURNING *`, then a scoped read on conflict. Retry-safe BY
      // CONSTRUCTION — which is what makes row 10 a property of the code rather
      // than of the order this fixture happens to run in.
      persist(input: PersistFindingInput): Promise<FindingRecord> {
        if (broken.has(input.signature)) {
          return Promise.reject(new Error("o008t-findings-store-unavailable"));
        }
        const key = findingKey(ctx.organizationId, input.projectId, input.signature);
        const existing = stored.get(key);
        if (existing) return Promise.resolve(existing);

        const row = {
          ...input,
          id: `o008t-finding-${String(nextId)}`,
          organizationId: ctx.organizationId,
          createdAt: AT,
        } as unknown as FindingRecord;
        nextId += 1;
        stored.set(key, row);
        return Promise.resolve(row);
      },

      listForProject(projectId: string): Promise<FindingRecord[]> {
        return Promise.resolve(
          [...stored.values()].filter(
            (row) => row.organizationId === ctx.organizationId && row.projectId === projectId,
          ),
        );
      },

      findBySignature(projectId: string, signature: string): Promise<FindingRecord | null> {
        return Promise.resolve(
          stored.get(findingKey(ctx.organizationId, projectId, signature)) ?? null,
        );
      },
    }),
  };
}

interface FakeRuns {
  repoFor: (ctx: TenantContext) => AnalysisRunsRepo;
  rows: () => AnalysisRunRecord[];
  /** Every `close` input, so "which terminal state, with which reason" is read
   *  off what the handler WROTE rather than off a count this file kept. */
  closes: () => readonly CloseRunInput[];
  /** The signatures that actually WON a claim — i.e. the cap consumed. */
  claimed: () => readonly string[];
  /** Seeds a `running` row exactly as an abandoned or concurrent run left it. */
  seedRunning: (input: { organizationId: string; projectId: string; startedAt: Date }) => string;
  /** Pre-spends N of the cap for one project, without going through a run. */
  spendClaims: (input: { organizationId: string; projectId: string; count: number }) => void;
}

function createFakeRuns(): FakeRuns {
  const runs = new Map<string, AnalysisRunRecord>();
  /** `(organization_id, project_id, signature)` — the retry guard. */
  const claims = new Set<string>();
  const closes: CloseRunInput[] = [];
  let nextRunId = 1;

  function projectClaimCount(organizationId: string, projectId: string): number {
    return [...claims].filter((key) => key.startsWith(`${organizationId}|${projectId}|`)).length;
  }

  function organizationClaimCount(organizationId: string): number {
    return [...claims].filter((key) => key.startsWith(`${organizationId}|`)).length;
  }

  function newRun(organizationId: string, projectId: string, startedAt: Date): AnalysisRunRecord {
    const run = {
      id: `o008t-run-${String(nextRunId)}`,
      organizationId,
      projectId,
      status: "running",
      outcome: null,
      stopReason: null,
      startedAt,
      finishedAt: null,
      failureReason: null,
      modelCallsAttempted: 0,
      candidatesUnrenderable: 0,
      candidatesRefused: 0,
      resolvedModelId: null,
      tokensIn: null,
      tokensOut: null,
      createdAt: startedAt,
    } as unknown as AnalysisRunRecord;
    nextRunId += 1;
    runs.set(run.id, run);
    return run;
  }

  return {
    rows: () => [...runs.values()],
    closes: () => [...closes],
    claimed: () => [...claims].map((key) => key.split("|")[2] ?? ""),
    seedRunning: (input) => newRun(input.organizationId, input.projectId, input.startedAt).id,
    spendClaims: (input) => {
      for (let index = 0; index < input.count; index += 1) {
        claims.add(
          findingKey(input.organizationId, input.projectId, `o008t-prespent-${String(index)}`),
        );
      }
    },
    repoFor: (ctx) => ({
      open(input: { projectId: string; tickAt: Date }): Promise<OpenRunResult> {
        const open = [...runs.values()].find(
          (row) =>
            row.organizationId === ctx.organizationId &&
            row.projectId === input.projectId &&
            row.status === "running",
        );

        if (open) {
          // AD-12's INHERITED LEASE, modelled exactly as
          // `analysis-runs.repo.ts:376-380` implements it: an incumbent older
          // than `ANALYSIS_RUN_LEASE_MS` is taken over rather than obeyed.
          //
          // THE CUTOFF IS COMPUTED FROM `input.tickAt`, never from a clock this
          // fake reads. That is the whole point of row 13: the trigger passes
          // its own instant through, so the lease is evaluated against the
          // trigger's time and not against wall-clock time.
          const cutoff = new Date(input.tickAt.getTime() - ANALYSIS_RUN_LEASE_MS);
          if (open.startedAt.getTime() >= cutoff.getTime()) {
            return Promise.resolve({ opened: false, run: open } as OpenRunResult);
          }
          const reclaimed = { ...open, status: "failed" } as unknown as AnalysisRunRecord;
          runs.set(reclaimed.id, reclaimed);
        }

        return Promise.resolve({
          opened: true,
          run: newRun(ctx.organizationId, input.projectId, input.tickAt),
        } as OpenRunResult);
      },

      close(input: CloseRunInput): Promise<AnalysisRunRecord> {
        closes.push(input);
        const existing = runs.get(input.runId);
        if (!existing) return Promise.reject(new Error(`no run ${input.runId} to close`));
        const closed = {
          ...existing,
          status: input.status,
          outcome: input.outcome,
          stopReason: input.stopReason,
          finishedAt: input.finishedAt,
          failureReason: input.failureReason ?? null,
          modelCallsAttempted: input.modelCallsAttempted,
          candidatesUnrenderable: input.candidatesUnrenderable,
          candidatesRefused: input.candidatesRefused,
          resolvedModelId: input.resolvedModelId,
          tokensIn: input.tokensIn,
          tokensOut: input.tokensOut,
        } as unknown as AnalysisRunRecord;
        runs.set(closed.id, closed);
        return Promise.resolve(closed);
      },

      // ONE STATEMENT, NO PRIOR READ. TWO CEILINGS, ONE ANSWER (AD-23): either
      // being spent refuses as `cap_exhausted`, and the real statement reports
      // no difference between them.
      claimModelCall(input: {
        projectId: string;
        runId: string;
        signature: string;
        signatureVersion: number;
        projectCap: number;
        organizationCap: number;
        at: Date;
      }) {
        const key = findingKey(ctx.organizationId, input.projectId, input.signature);
        if (claims.has(key)) {
          return Promise.resolve({ claimed: false as const, reason: "already_claimed" as const });
        }
        if (
          projectClaimCount(ctx.organizationId, input.projectId) >= input.projectCap ||
          organizationClaimCount(ctx.organizationId) >= input.organizationCap
        ) {
          return Promise.resolve({ claimed: false as const, reason: "cap_exhausted" as const });
        }
        claims.add(key);
        return Promise.resolve({ claimed: true as const });
      },
    }),
  };
}

function createFakeLedger(): { serviceFor: (ctx: TenantContext) => SignatureLedgerService } {
  return {
    serviceFor: (ctx) =>
      ({
        recordSignature(
          projectId: string,
          subject: CandidateFinding,
        ): Promise<RecordSignatureResult> {
          const record = {
            id: `o008t-signature-${subject.surface}`,
            organizationId: ctx.organizationId,
            projectId,
            signature: signatureHex("a1b2c3d4".repeat(8)),
            symptomClass: subject.finalClass,
            surface: subject.surface,
            signatureTupleVersion: 1,
            evidenceShapeVersion: subject.evidenceShapeVersion,
            surfaceNormalisationVersion: subject.surfaceNormalisationVersion,
            firstSeenAt: AT,
            lastSeenAt: AT,
          } as unknown as RecordSignatureResult;
          return Promise.resolve(record);
        },
      }) as unknown as SignatureLedgerService,
  };
}

// ===========================================================================
// The deps builder — one assembly every behavioural row shares
// ===========================================================================

interface Harness {
  deps: MirrorOnboardingAnalysisDeps;
  findings: FakeFindings;
  runs: FakeRuns;
  summariser: CountingSummariser;
  logger: RecordingLogger;
  /** The lanes this harness's source will hand back, keyed by project id. */
  setLane: (projectId: string, value: AnalysisLane | null) => void;
}

/**
 * A harness whose lane SOURCE is a stub rather than the real producer.
 *
 * Deliberate: the real producer's own contract is rows 2/3/6, which drive
 * `createAnalysisLaneSource` against a real database. Every OTHER row is about
 * what the trigger does with a lane once it has one, and seeding a real corpus
 * for each would make those rows fail for reasons that have nothing to do with
 * their subject.
 */
function harness(
  options: { projectCap?: number; organizationCap?: number; summariser?: CountingSummariser } = {},
): Harness {
  const findings = createFakeFindings();
  const runs = createFakeRuns();
  const ledger = createFakeLedger();
  const logger = createRecordingLogger();
  const summariser = options.summariser ?? cleanSummariser();
  const lanes = new Map<string, AnalysisLane | null>();

  return {
    findings,
    runs,
    summariser,
    logger,
    setLane: (projectId, value) => lanes.set(projectId, value),
    deps: {
      lanes: {
        listDueLanes: () =>
          Promise.resolve(
            [...lanes.values()].filter((value): value is AnalysisLane => value !== null),
          ),
        laneForProject: (projectId: string) => Promise.resolve(lanes.get(projectId) ?? null),
      },
      summariser: { port: summariser.port, resolvedModelId: MODEL_ID },
      findingsFor: findings.repoFor,
      runsFor: runs.repoFor,
      ledgerFor: ledger.serviceFor,
      projectCap: options.projectCap ?? COLDSTART_MODEL_CALL_CAP,
      organizationCap: options.organizationCap ?? ORG_CAP_WIDE_ENOUGH_TO_NEVER_REFUSE,
      now: () => AT,
      logger,
    },
  };
}

// ===========================================================================
// The source scanners, with their MANDATORY controls (ADD §9 standing rule 1)
// ===========================================================================

/** The four call sites AD-9 forbids the trigger to contain. A trigger holding
 *  any of them has a second pipeline, whatever its comments claim. */
const FORBIDDEN_IN_TRIGGER = [
  "claimModelCall",
  "findings.persist",
  "runs.open",
  "runs.close",
] as const;

function forbiddenCallSitesIn(source: string): string[] {
  return FORBIDDEN_IN_TRIGGER.filter((needle) => source.includes(needle));
}

/** A PLANTED OFFENDER: a trigger that opened its own run and claimed its own
 *  model call — the exact second pipeline FR-O16/FR-O17 forbid. */
const PLANTED_SECOND_PIPELINE = `
  export async function runOnboardingAnalysis(deps, payload) {
    const opened = await runs.open({ projectId: payload.projectId, tickAt: deps.now() });
    const claim = await runs.claimModelCall({ projectId: payload.projectId });
    await findings.persist({ projectId: payload.projectId });
    await runs.close({ runId: opened.run.id, status: "completed" });
  }
`;

/** A CLEAN FIXTURE: the shape AD-9 requires — a project id in, one call to the
 *  shared lane runner, and nothing else. */
const CLEAN_TRIGGER = `
  import { runAnalysisLane } from "./analysis-tick";
  export async function runOnboardingAnalysis(deps, payload) {
    const { projectId } = onboardingAnalysisPayloadSchema.parse(payload);
    const lane = await deps.lanes.laneForProject(projectId, deps.now());
    if (lane === null) return null;
    return runAnalysisLane(deps, lane, deps.now());
  }
`;

/** AD-12: any column or flag by which the trigger could consume the project's
 *  turn and convert a transient miss into a permanent hole. */
const SUPPRESSION_MARKERS = [
  "next_analysis_at",
  "nextAnalysisAt",
  "lastAnalysedAt",
  "last_analysed_at",
  "suppressUntil",
  "skipNextTick",
  "analysisScheduledAt",
] as const;

function suppressionMarkersIn(source: string): string[] {
  return SUPPRESSION_MARKERS.filter((needle) => source.includes(needle));
}

const PLANTED_SUPPRESSION = `
  await projects.update({ id: projectId, next_analysis_at: addHours(deps.now(), 1) });
`;

// ===========================================================================
// The real-database fixtures — rows 2, 3 and 6 only
// ===========================================================================

let db: TestDb;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});

afterEach(async () => {
  await close();
});

// ###########################################################################
// LANE REUSE — AD-9, AD-10, FR-O16
// ###########################################################################

// Row 1 — the structural half of FR-O16, and the one that cannot rot.
test("the trigger reuses the analysis tick lane logic rather than a second pipeline", async () => {
  // BOTH CONTROLS FIRST, BEFORE ANY CLAIM ABOUT REAL SOURCE (§9 standing rule
  // 1). A scanner that matched nothing would otherwise report green forever,
  // and this row is the load-bearing half of a financial commitment.
  expect(forbiddenCallSitesIn(PLANTED_SECOND_PIPELINE).toSorted()).toEqual(
    [...FORBIDDEN_IN_TRIGGER].toSorted(),
  );
  expect(forbiddenCallSitesIn(CLEAN_TRIGGER)).toEqual([]);
  expect(CLEAN_TRIGGER).toContain("runAnalysisLane");
  expect(PLANTED_SECOND_PIPELINE).not.toContain("runAnalysisLane");

  // THE SHARED RUNNER IS REALLY EXPORTED. AD-9's extraction is what the scan
  // below is a claim ABOUT — a trigger importing a `runAnalysisLane` that
  // `analysis-tick.ts` does not export would satisfy every string check here
  // and fail to load at runtime.
  await loadRunAnalysisLane();

  const source = readSourceUnderConstruction({
    repoRelativePath: TRIGGER_SOURCE_PATH,
    ownedBy: OWNER_TRIGGER,
  });

  // NO MODEL-CALL SITE OF ITS OWN TO GET WRONG. This is R-AD9 as a fact about
  // the file rather than a claim in a comment.
  expect(forbiddenCallSitesIn(source)).toEqual([]);
  // AND IT REACHES THE SHARED RUNNER. Absence of the four above without this
  // would also describe a trigger that does nothing at all.
  expect(source).toContain("runAnalysisLane");
});

// Row 2 — AD-10, the deep-equality proof that there is ONE assembly.
test("listDueLanes and laneForProject produce an identical lane for the same project", async () => {
  const logger = createRecordingLogger();
  const workspace = await seedPollableWorkspace(db, { prefix: PREFIX, now: AT });

  const source = widenedLaneSource(db, logger);

  const [fromList] = await source.listDueLanes(AT);
  const fromProject = await source.laneForProject(workspace.projectId, AT);

  expect(fromList).toBeDefined();
  expect(fromList?.projectId).toBe(workspace.projectId);

  // DEEP EQUALITY, NOT FIELD SPOT-CHECKS. The corpus window, both T1 detectors
  // and `assembleCandidates` are what decide WHAT A FINDING EVEN IS; a second
  // copy of that assembly would drift within a sprint and would make the
  // onboarding surface show a different finding than Slack does.
  expect(fromProject).toEqual(fromList as AnalysisLane);
});

// Row 3 — graceful absence.
test("laneForProject returns null for a project that does not exist", async () => {
  const logger = createRecordingLogger();

  const source = widenedLaneSource(db, logger);

  // NULL, not a throw and not an empty lane — an empty lane would open a run
  // and close it, which is a different and false claim ("we looked").
  //
  // AMENDED. This row previously seeded an INACTIVE connection and asserted
  // `null`, reasoning that such a project is outside `listAnalysableProjects`'s
  // population. That reasoning is right about `listAnalysableProjects` and
  // wrong about this method. `findAnalysableProject` deliberately carries NO
  // active-connection predicate (AD-12's fail direction), so that a revocation
  // landing in the seconds after a poll does not drop the founder's one
  // analysis. Re-adding the predicate to satisfy the old claim would have cost
  // more than it looked: a revoked project is excluded from
  // `listAnalysableProjects` too, so the hourly cron would not pick it up
  // either — the analysis would be lost outright rather than delayed, which is
  // precisely the silent drop AD-12 exists to forbid.
  //
  // The revoked-connection case is now asserted where it belongs, as a
  // POSITIVE claim: `analysis-lane-source.for-project.test.ts` row 1, "a
  // project whose connection was revoked after the poll still resolves a
  // lane", with `listAnalysableProjects(db) === []` as its control so the
  // divergence between the two reads is exercised rather than assumed.
  expect(await source.laneForProject("00000000-0000-4000-8000-000000000000", AT)).toBeNull();
  expect(await source.listDueLanes(AT)).toEqual([]);
});

// Row 4 — EC-O7. PAIRED with row 5; neither stands alone (banned-row rule 2).
test("the trigger derives org scope from the project row, never from the payload", async () => {
  const schema = await loadPayloadSchema();

  const keys = Object.keys(schema.shape);

  // THE VALUE THAT CANNOT ARRIVE CANNOT BE MIS-SCOPED. There is no
  // `organizationId` to trust and no `userId` to impersonate, so the worker has
  // nothing to derive scope from except the project row it reads.
  expect(keys).not.toContain("organizationId");
  expect(keys).not.toContain("userId");
  expect(keys).toEqual(["projectId"]);
});

// Row 5 — the BEHAVIOURAL half. Wave 0a measured why this row exists: a plain
// `z.object()` returns `success: true` and SILENTLY STRIPS the extra key, and
// `Object.keys(shape)` is identical for both constructors, so row 4 alone would
// stay green against a schema that accepts a client-supplied organization id.
test("a payload carrying an organization id is rejected by the strict schema", async () => {
  const schema = await loadPayloadSchema();

  expect(schema.safeParse({ projectId: "p1" }).success).toBe(true);

  // REFUSAL, NOT STRIPPING.
  expect(schema.safeParse({ projectId: "p1", organizationId: "org-b" }).success).toBe(false);
  expect(schema.safeParse({ projectId: "p1", userId: "u1" }).success).toBe(false);
  expect(schema.safeParse({ projectId: "p1", organizationId: "org-b", userId: "u1" }).success).toBe(
    false,
  );
});

// Row 6 — D7.
test("a project id belonging to another org yields no lane and no run", async () => {
  const logger = createRecordingLogger();

  const orgA = await seedPollableWorkspace(db, { prefix: `${PREFIX}a-`, now: AT });
  const orgB = await seedPollableWorkspace(db, { prefix: `${PREFIX}b-`, now: AT });

  const source = widenedLaneSource(db, logger);

  const laneB = await source.laneForProject(orgB.projectId, AT);

  // THE LANE'S ORG COMES OFF THE PROJECT ROW. Org A cannot appear on a lane
  // built for org B's project by any route, because nothing in the call carries
  // an org at all — the id is resolved to a row and the row carries its owner.
  expect(laneB?.organizationId).toBe(orgB.organizationId);
  expect(laneB?.organizationId).not.toBe(orgA.organizationId);

  const run = harness();
  run.setLane(orgB.projectId, laneB);

  const runOnboardingAnalysis = await loadRunOnboardingAnalysis();
  await runOnboardingAnalysis(run.deps, { projectId: orgB.projectId });

  // AND NOTHING IS WRITTEN UNDER ORG A. Not one run row, not one finding.
  expect(run.runs.rows().filter((row) => row.organizationId === orgA.organizationId)).toEqual([]);
  expect(run.findings.rows().filter((row) => row.organizationId === orgA.organizationId)).toEqual(
    [],
  );
});

// ###########################################################################
// Row 7 — FR-O17. THE NEVER-CUT ROW. A cap-bypassing trigger is a FINANCIAL
// COMMITMENT and an Always-Check-With-Tom item. Both ceilings, separately.
// ###########################################################################
test("the trigger claims model calls under the same two ceilings", async () => {
  const runOnboardingAnalysis = await loadRunOnboardingAnalysis();

  // --- ceiling one: the PER-PROJECT cap -----------------------------------
  const projectAtCap = harness({
    projectCap: COLDSTART_MODEL_CALL_CAP,
    summariser: retryableFailureSummariser(),
  });
  projectAtCap.runs.spendClaims({
    organizationId: ORG,
    projectId: PROJECT,
    count: COLDSTART_MODEL_CALL_CAP,
  });
  projectAtCap.setLane(PROJECT, lane({ candidates: [CANDIDATE_A, CANDIDATE_B] }));

  await runOnboardingAnalysis(projectAtCap.deps, { projectId: PROJECT });

  // A PROJECT AT `COLDSTART_MODEL_CALL_CAP` CLAIMS NOTHING, so it spends
  // nothing. Zero calls — not "few", not "fewer".
  expect(projectAtCap.summariser.calls()).toBe(0);

  // --- ceiling two: the ORGANISATION-WIDE cap ------------------------------
  // A SECOND CEILING, NOT A SECOND RUNG (AD-23). Without it the per-project cap
  // bounds nothing in aggregate: no limit exists on how many projects an
  // organisation creates. The project here is FRESH — its own cap is untouched,
  // so a trigger that only honoured the per-project ceiling would spend here.
  const orgAtCap = harness({
    projectCap: COLDSTART_MODEL_CALL_CAP,
    organizationCap: ORG_MODEL_CALL_CAP,
    summariser: retryableFailureSummariser(),
  });
  orgAtCap.runs.spendClaims({
    organizationId: ORG,
    projectId: OTHER_PROJECT,
    count: ORG_MODEL_CALL_CAP,
  });
  orgAtCap.setLane(PROJECT, lane({ candidates: [CANDIDATE_A, CANDIDATE_B] }));

  await runOnboardingAnalysis(orgAtCap.deps, { projectId: PROJECT });

  expect(orgAtCap.summariser.calls()).toBe(0);
});

// Row 8 — the CRITICAL a prior audit found.
test("a path that reaches a model without a claim fails this suite", async () => {
  const runOnboardingAnalysis = await loadRunOnboardingAnalysis();

  // THE RETRYABLE CLASS, DELIBERATELY. `call_failed` is the port's transient
  // arm — the one an SDK-level retry reacts to. A fake returning SUCCESS is
  // indistinguishable from a lane that called once and stopped, so it would
  // pass against a handler that retries past the claim; this one cannot.
  const run = harness({
    projectCap: 1,
    summariser: retryableFailureSummariser(),
  });
  run.setLane(PROJECT, lane({ candidates: [CANDIDATE_A, CANDIDATE_B] }));

  await runOnboardingAnalysis(run.deps, { projectId: PROJECT });

  const claims = run.runs.claimed().length;

  // CALLS MAY NEVER EXCEED CLAIMS. Every model call is money, and the claim is
  // the only thing that meters it — a call the ledger never saw is spend the
  // cap cannot bound, on either ceiling, forever.
  expect(run.summariser.calls()).toBeLessThanOrEqual(claims);
  // AND THE CAP WAS REALLY THE BINDING CONSTRAINT: one claim for two
  // candidates, so this is not vacuously true against a lane that did nothing.
  expect(claims).toBe(1);
});

// Row 9 — D6. The single-writer guarantee working is not a failure.
test("a project with a run already open is an ordinary outcome, not an error", async () => {
  const runOnboardingAnalysis = await loadRunOnboardingAnalysis();

  const run = harness();
  // A run opened ONE MINUTE AGO — comfortably inside `ANALYSIS_RUN_LEASE_MS`,
  // so this is a live concurrent run and not an abandoned one (row 13's case).
  const incumbentId = run.runs.seedRunning({
    organizationId: ORG,
    projectId: PROJECT,
    startedAt: new Date(AT.getTime() - 60_000),
  });
  run.setLane(PROJECT, lane());

  // NO THROW. The partial unique index refusing our run is the guarantee
  // working, and a trigger that treated it as an error would surface a fault to
  // a founder for a system behaving exactly as designed.
  await runOnboardingAnalysis(run.deps, { projectId: PROJECT });

  // NO SECOND RUN ROW.
  expect(run.runs.rows()).toHaveLength(1);
  expect(run.runs.rows()[0]?.id).toBe(incumbentId);

  // AND NO TERMINAL WRITE ONTO SOMEBODY ELSE'S RUN. Stamping our outcome on a
  // run another worker is still walking is worse than doing nothing.
  expect(run.runs.closes()).toEqual([]);
  expect(run.runs.rows()[0]?.status).toBe("running");
});

// Row 10 — EC-O3, BOTH constraints in one row because they are one guarantee.
test("the trigger fired twice for one project produces one run and one finding", async () => {
  const runOnboardingAnalysis = await loadRunOnboardingAnalysis();

  const run = harness();
  run.setLane(PROJECT, lane());

  await runOnboardingAnalysis(run.deps, { projectId: PROJECT });
  await runOnboardingAnalysis(run.deps, { projectId: PROJECT });

  // ONE FINDING: `findings_org_project_signature_key` refuses the duplicate and
  // the insert reads back the row it already wrote (D4).
  expect(run.findings.rows()).toHaveLength(1);
  expect(run.findings.rows()[0]?.signature).toBe(signatureOf(PROJECT, CANDIDATE_A));

  // ONE CLAIM: `ON CONFLICT (organization_id, project_id, signature)` refuses a
  // repeat model call for the same candidate, so the second pass costs nothing.
  expect(run.runs.claimed()).toHaveLength(1);

  // The first run closed before the second opened, so two runs exist and BOTH
  // are terminal — the constraint EC-O3 names is one finding, not one row.
  for (const row of run.runs.rows()) {
    expect(row.status).not.toBe("running");
  }
});

// Row 11 — EC-O8 / D8. A `running` row NEVER survives.
test("every exit path records a terminal completed or failed", async () => {
  const runOnboardingAnalysis = await loadRunOnboardingAnalysis();

  // EVERY exit path this trigger has, enumerated — a row asserting one of them
  // would leave the other three free to jam a project's lane forever behind the
  // partial unique index.
  const paths: readonly { name: string; build: () => Harness }[] = [
    {
      name: "ran to completion",
      build: () => {
        const run = harness();
        run.setLane(PROJECT, lane());
        return run;
      },
    },
    {
      name: "cap exhausted before any call",
      build: () => {
        const run = harness({ projectCap: 0 });
        run.setLane(PROJECT, lane());
        return run;
      },
    },
    {
      name: "a store fault mid-walk",
      build: () => {
        const run = harness();
        run.findings.breakOn(signatureOf(PROJECT, CANDIDATE_A));
        run.setLane(PROJECT, lane());
        return run;
      },
    },
    {
      name: "an empty lane",
      build: () => {
        const run = harness();
        run.setLane(PROJECT, lane({ candidates: [], sessionsConsidered: 0 }));
        return run;
      },
    },
  ];

  for (const path of paths) {
    const run = path.build();
    await runOnboardingAnalysis(run.deps, { projectId: PROJECT });

    const running = run.runs.rows().filter((row) => row.status === "running");
    expect({ path: path.name, running }).toEqual({ path: path.name, running: [] });

    for (const row of run.runs.rows()) {
      expect({ path: path.name, status: row.status }).toEqual({
        path: path.name,
        status: row.status === "failed" ? "failed" : "completed",
      });
    }
  }
});

// Row 12 — the jam-prevention path.
test("a lane that throws mid-walk closes its run as failed with a reason", async () => {
  const runOnboardingAnalysis = await loadRunOnboardingAnalysis();

  const run = harness();
  run.findings.breakOn(signatureOf(PROJECT, CANDIDATE_A));
  run.setLane(PROJECT, lane());

  // NO THROW OUT OF THE TRIGGER. An isolated failure that travels as an
  // exception is a failure that can abort whatever called it (D8).
  await runOnboardingAnalysis(run.deps, { projectId: PROJECT });

  const [closed] = run.runs.closes();
  expect(closed).toBeDefined();
  expect(closed?.status).toBe("failed");
  // A REASON, NOT JUST A STATUS. "It failed" with no stop reason is a row
  // nobody can act on, and the surface renders the reason to a founder.
  expect(closed?.stopReason).toBe("fatal_error");
  expect(run.runs.rows().every((row) => row.status !== "running")).toBe(true);
});

// Row 13 — AD-12's INHERITED lease.
//
// WHAT THIS ROW OWNS AND WHAT IT DOES NOT. The lease ITSELF — the `WHERE
// started_at < cutoff` reclaim — is proven against real SQL where it lives, in
// `packages/db/__tests__/repositories/analysis-runs.repo.test.ts`. What this
// row owns is the INHERITANCE: the trigger goes through the same `runs.open()`
// and passes its OWN instant, so a project jammed by a dead trigger is handed
// back on the same 45-minute terms as one jammed by a dead tick. A trigger that
// hardcoded a clock, or that implemented its own reclaim, would fail here.
test("an abandoned running row older than the lease is reclaimed", async () => {
  const runOnboardingAnalysis = await loadRunOnboardingAnalysis();

  // --- just inside the lease: the incumbent is respected --------------------
  const inside = harness();
  inside.runs.seedRunning({
    organizationId: ORG,
    projectId: PROJECT,
    startedAt: new Date(AT.getTime() - (ANALYSIS_RUN_LEASE_MS - 60_000)),
  });
  inside.setLane(PROJECT, lane());
  await runOnboardingAnalysis(inside.deps, { projectId: PROJECT });
  expect(inside.runs.rows()).toHaveLength(1);
  expect(inside.findings.rows()).toEqual([]);

  // --- past the lease: the row is reclaimed and the project analysed --------
  const past = harness();
  past.runs.seedRunning({
    organizationId: ORG,
    projectId: PROJECT,
    startedAt: new Date(AT.getTime() - (ANALYSIS_RUN_LEASE_MS + 60_000)),
  });
  past.setLane(PROJECT, lane());
  await runOnboardingAnalysis(past.deps, { projectId: PROJECT });

  // A NEW RUN EXISTS AND IT FINISHED. The abandoned row no longer jams the lane.
  expect(past.runs.rows().length).toBeGreaterThan(1);
  expect(past.runs.rows().filter((row) => row.status === "running")).toEqual([]);
  expect(past.findings.rows()).toHaveLength(1);
});

// ###########################################################################
// FAIL DIRECTION — AD-12, EC-O10, AC-O20
// ###########################################################################

// Row 14 — the D10 fail-direction proof. THE CRON IS THE FLOOR.
test("a trigger that cannot run degrades to the hourly cron, never to silence", async () => {
  // Loaded FIRST so this row is red for the trigger's absence rather than
  // quietly green against `runAnalysisTick`, which ships today. The trigger
  // never fires below — its ABSENCE from the sequence is the fixture.
  await loadRunOnboardingAnalysis();

  async function tickOnly(): Promise<{
    summary: unknown;
    findings: number;
    closes: readonly CloseRunInput[];
  }> {
    const run = harness();
    run.setLane(PROJECT, lane());
    const summary = await runAnalysisTick({
      ...run.deps,
      lanes: run.deps.lanes,
    } as unknown as AnalysisTickDeps);
    return { summary, findings: run.findings.rows().length, closes: run.runs.closes() };
  }

  const withoutTrigger = await tickOnly();
  const alsoWithoutTrigger = await tickOnly();

  // IDENTICAL OUTPUT. The hourly tick's behaviour for this project does not
  // depend on whether a trigger ever ran, which is what makes a missed trigger
  // a DELAY rather than a hole. Nothing the trigger does — or fails to do —
  // is an input to this.
  expect(withoutTrigger.summary).toEqual(alsoWithoutTrigger.summary);
  expect(withoutTrigger.findings).toBe(alsoWithoutTrigger.findings);
  expect(withoutTrigger.findings).toBe(1);
  expect(withoutTrigger.closes.map((row) => row.status)).toEqual(["completed"]);
});

// Row 15 — the marker that would convert a transient miss into a permanent hole.
test("the trigger writes no marker that suppresses or reschedules the hourly run", () => {
  // CONTROLS FIRST (§9 standing rule 1).
  expect(suppressionMarkersIn(PLANTED_SUPPRESSION)).toEqual(["next_analysis_at"]);
  expect(suppressionMarkersIn(CLEAN_TRIGGER)).toEqual([]);

  const source = readSourceUnderConstruction({
    repoRelativePath: TRIGGER_SOURCE_PATH,
    ownedBy: OWNER_TRIGGER,
  });

  // A trigger that CONSUMED the project's turn — by stamping a
  // `next_analysis_at`, by claiming a run it then abandoned, or by writing any
  // "already handled" marker — would make a transient miss permanent. It writes
  // no such thing, so the cron's own claim is untouched.
  expect(suppressionMarkersIn(source)).toEqual([]);
});

// Row 16 — D8 isolation AT THE CALL SITE.
//
// The behavioural half of this — a failing trigger leaves the poll run
// `completed` and the watermark advanced — is driven through the REAL poll
// entry point in `onboarding-trigger-wire.test.ts` (task 0e.2). What this row
// owns is the STRUCTURE that makes it true on every path rather than on the one
// the sibling suite happens to exercise: the call is inside its own try/catch.
test("a trigger that throws leaves the poll successful", () => {
  const withGuard = `
    try {
      await deps.requestAnalysis.requestForProject({ projectId: connection.projectId });
    } catch (error) {
      deps.logger.error("could not request analysis");
    }
  `;
  const withoutGuard = `
    await deps.requestAnalysis.requestForProject({ projectId: connection.projectId });
  `;

  // CONTROLS FIRST. The scanner must bite on the unguarded call, or its silence
  // about the real source means nothing.
  expect(callIsGuarded(withGuard)).toBe(true);
  expect(callIsGuarded(withoutGuard)).toBe(false);

  const source = readSourceUnderConstruction({
    repoRelativePath: POLL_SOURCE_PATH,
    ownedBy: OWNER_POLL,
  });

  assertUnderConstruction(source.includes("requestForProject"), {
    contract:
      "SessionSourcePollDeps.requestAnalysis — the AnalysisTrigger port, called from pollConnection",
    ownedBy: OWNER_POLL,
  });

  // BEST-EFFORT, BY CONSTRUCTION. The poll's job is to persist events; asking
  // for an analysis is a courtesy on top, and a courtesy that can fail the
  // thing it decorates is a bug (D8).
  expect(callIsGuarded(source)).toBe(true);
});

/**
 * Does every `requestForProject` call sit inside a `try` block?
 *
 * Deliberately crude and deliberately CONSERVATIVE: it answers "is there a
 * `try` opened before the call and a `catch` after it", which is exactly the
 * property the row claims, and it is proven to discriminate by the two controls
 * above rather than trusted.
 */
function callIsGuarded(source: string): boolean {
  const at = source.indexOf("requestForProject");
  if (at < 0) return false;
  const before = source.slice(0, at);
  const after = source.slice(at);
  return /\btry\b\s*\{/.test(before) && /\bcatch\b/.test(after);
}
