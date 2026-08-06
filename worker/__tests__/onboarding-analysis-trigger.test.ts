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
import { isolated } from "../src/task-logger";
import type {
  AnalysisLane,
  AnalysisLaneSource,
  AnalysisLogger,
  AnalysisTickDeps,
} from "../src/tasks/analysis-tick";
import { runAnalysisTick } from "../src/tasks/analysis-tick";
import { seedPollableWorkspace } from "./helpers/wire-fixtures";

const OWNER_TRIGGER = "ADD Wave 3 (worker/src/tasks/onboarding-analysis.ts, AD-11)";
const OWNER_LANE = "ADD Wave 3 (worker/src/tasks/analysis-tick.ts — export runAnalysisLane, AD-9)";
const OWNER_SOURCE = "ADD Wave 3 (worker/src/analysis-lane-source.ts — laneForProject, AD-10)";

const TRIGGER_SOURCE_PATH = "worker/src/tasks/onboarding-analysis.ts";

type MirrorLaneOutcome = "completed" | "failed" | "already_running";

type MirrorLaneTally = {
  readonly findingsPersisted: number;
  readonly unrenderable: number;
  readonly refused: number;
  readonly modelCallsAttempted: number;
};

type MirrorLaneRunResult = {
  readonly outcome: MirrorLaneOutcome;
  readonly tally: MirrorLaneTally;
};

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

type MirrorRunAnalysisLane = (
  deps: MirrorAnalysisLaneDeps,
  lane: AnalysisLane,
  at: Date,
) => Promise<MirrorLaneRunResult>;

type MirrorAnalysisLaneSource = AnalysisLaneSource & {
  laneForProject(projectId: string, now: Date): Promise<AnalysisLane | null>;
};

type MirrorOnboardingAnalysisDeps = MirrorAnalysisLaneDeps & {
  readonly lanes: MirrorAnalysisLaneSource;
};

type MirrorRunOnboardingAnalysis = (
  deps: MirrorOnboardingAnalysisDeps,
  payload: unknown,
) => Promise<unknown>;

type MirrorPayloadSchema = {
  readonly shape: Record<string, unknown>;
  safeParse(input: unknown): { success: boolean; error?: unknown };
};

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

    exportName: "onboardingAnalysisPayloadSchema",
    ownedBy: OWNER_TRIGGER,
  });

function widenedLaneSource(db: TestDb, logger: AnalysisLogger): MirrorAnalysisLaneSource {
  const source = createAnalysisLaneSource({ db, logger }) as Partial<MirrorAnalysisLaneSource>;

  assertUnderConstruction(typeof source.laneForProject === "function", {
    contract:
      "AnalysisLaneSource.laneForProject(projectId, now) — AD-10's second caller of buildLane",
    ownedBy: OWNER_SOURCE,
  });

  return source as MirrorAnalysisLaneSource;
}

const PREFIX = "o008t-";

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

const ORG_CAP_WIDE_ENOUGH_TO_NEVER_REFUSE = 10_000;

const CLEAN_HEADLINE = "The payment step is losing sessions";
const CLEAN_CONTEXT = "Sessions reached the payment step and left without finishing.";

function count(numerator: number, kept: number): MeasuredCount {
  return measuredCount({
    numerator,
    denominator: kept,
    unit: "sessions",
    timeframe: WINDOW,
    basis: { totalInWindow: kept, kept, keptUnchecked: 0, setAside: [] },
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

interface RecordingLogger extends AnalysisLogger {
  readonly infos: string[];
  readonly warns: string[];
  readonly errors: string[];
}

function createRecordingLogger(): RecordingLogger {
  const infos: string[] = [];
  const warns: string[] = [];
  const errors: string[] = [];
  return {
    infos,
    warns,
    errors,
    info: (message: string) => {
      infos.push(message);
    },
    warn: (message: string) => {
      warns.push(message);
    },
    error: (message: string) => {
      errors.push(message);
    },
  };
}

interface CountingSummariser {
  port: SessionSummariser;

  calls: () => number;
}

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

      findById(projectId: string, id: string): Promise<FindingRecord | null> {
        return Promise.resolve(
          [...stored.values()].find(
            (row) =>
              row.organizationId === ctx.organizationId &&
              row.projectId === projectId &&
              row.id === id,
          ) ?? null,
        );
      },
    }),
  };
}

interface FakeRuns {
  repoFor: (ctx: TenantContext) => AnalysisRunsRepo;
  rows: () => AnalysisRunRecord[];

  closes: () => readonly CloseRunInput[];

  claimed: () => readonly string[];

  seedRunning: (input: { organizationId: string; projectId: string; startedAt: Date }) => string;

  spendClaims: (input: { organizationId: string; projectId: string; count: number }) => void;
}

function createFakeRuns(): FakeRuns {
  const runs = new Map<string, AnalysisRunRecord>();

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
        // planCandidate (worker/src/analysis/plan.ts) now consults this for every
        // candidate unconditionally — a permissive default keeps this file's tests
        // exercising the same "deliver" path they did before dismissal existed.
        consultSignature() {
          return Promise.resolve({ decision: "deliver", reason: "not_seen_before" });
        },
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

interface Harness {
  deps: MirrorOnboardingAnalysisDeps;
  findings: FakeFindings;
  runs: FakeRuns;
  summariser: CountingSummariser;
  logger: RecordingLogger;

  setLane: (projectId: string, value: AnalysisLane | null) => void;
}

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

const FORBIDDEN_IN_TRIGGER = [
  "claimModelCall",
  "findings.persist",
  "runs.open",
  "runs.close",
] as const;

function forbiddenCallSitesIn(source: string): string[] {
  return FORBIDDEN_IN_TRIGGER.filter((needle) => source.includes(needle));
}

const PLANTED_SECOND_PIPELINE = `
  export async function runOnboardingAnalysis(deps, payload) {
    const opened = await runs.open({ projectId: payload.projectId, tickAt: deps.now() });
    const claim = await runs.claimModelCall({ projectId: payload.projectId });
    await findings.persist({ projectId: payload.projectId });
    await runs.close({ runId: opened.run.id, status: "completed" });
  }
`;

const CLEAN_TRIGGER = `
  import { runAnalysisLane } from "./analysis-tick";
  export async function runOnboardingAnalysis(deps, payload) {
    const { projectId } = onboardingAnalysisPayloadSchema.parse(payload);
    const lane = await deps.lanes.laneForProject(projectId, deps.now());
    if (lane === null) return null;
    return runAnalysisLane(deps, lane, deps.now());
  }
`;

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

let db: TestDb;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});

afterEach(async () => {
  await close();
});

test("the trigger reuses the analysis tick lane logic rather than a second pipeline", async () => {
  expect(forbiddenCallSitesIn(PLANTED_SECOND_PIPELINE).toSorted()).toEqual(
    [...FORBIDDEN_IN_TRIGGER].toSorted(),
  );
  expect(forbiddenCallSitesIn(CLEAN_TRIGGER)).toEqual([]);
  expect(CLEAN_TRIGGER).toContain("runAnalysisLane");
  expect(PLANTED_SECOND_PIPELINE).not.toContain("runAnalysisLane");

  await loadRunAnalysisLane();

  const source = readSourceUnderConstruction({
    repoRelativePath: TRIGGER_SOURCE_PATH,
    ownedBy: OWNER_TRIGGER,
  });

  expect(forbiddenCallSitesIn(source)).toEqual([]);

  expect(source).toContain("runAnalysisLane");
});

test("listDueLanes and laneForProject produce an identical lane for the same project", async () => {
  const logger = createRecordingLogger();
  const workspace = await seedPollableWorkspace(db, { prefix: PREFIX, now: AT });

  const source = widenedLaneSource(db, logger);

  const [fromList] = await source.listDueLanes(AT);
  const fromProject = await source.laneForProject(workspace.projectId, AT);

  expect(fromList).toBeDefined();
  expect(fromList?.projectId).toBe(workspace.projectId);

  expect(fromProject).toEqual(fromList as AnalysisLane);
});

test("laneForProject returns null for a project that does not exist", async () => {
  const logger = createRecordingLogger();

  const source = widenedLaneSource(db, logger);

  expect(await source.laneForProject("00000000-0000-4000-8000-000000000000", AT)).toBeNull();
  expect(await source.listDueLanes(AT)).toEqual([]);
});

test("the trigger derives org scope from the project row, never from the payload", async () => {
  const schema = await loadPayloadSchema();

  const keys = Object.keys(schema.shape);

  expect(keys).not.toContain("organizationId");
  expect(keys).not.toContain("userId");
  expect(keys).toEqual(["projectId"]);
});

test("a payload carrying an organization id is rejected by the strict schema", async () => {
  const schema = await loadPayloadSchema();

  expect(schema.safeParse({ projectId: "p1" }).success).toBe(true);

  expect(schema.safeParse({ projectId: "p1", organizationId: "org-b" }).success).toBe(false);
  expect(schema.safeParse({ projectId: "p1", userId: "u1" }).success).toBe(false);
  expect(schema.safeParse({ projectId: "p1", organizationId: "org-b", userId: "u1" }).success).toBe(
    false,
  );
});

test("a project id belonging to another org yields no lane and no run", async () => {
  const logger = createRecordingLogger();

  const orgA = await seedPollableWorkspace(db, { prefix: `${PREFIX}a-`, now: AT });
  const orgB = await seedPollableWorkspace(db, { prefix: `${PREFIX}b-`, now: AT });

  const source = widenedLaneSource(db, logger);

  const laneB = await source.laneForProject(orgB.projectId, AT);

  expect(laneB?.organizationId).toBe(orgB.organizationId);
  expect(laneB?.organizationId).not.toBe(orgA.organizationId);

  const run = harness();
  run.setLane(orgB.projectId, laneB);

  const runOnboardingAnalysis = await loadRunOnboardingAnalysis();
  await runOnboardingAnalysis(run.deps, { projectId: orgB.projectId });

  expect(run.runs.rows().filter((row) => row.organizationId === orgA.organizationId)).toEqual([]);
  expect(run.findings.rows().filter((row) => row.organizationId === orgA.organizationId)).toEqual(
    [],
  );
});

test("the trigger claims model calls under the same two ceilings", async () => {
  const runOnboardingAnalysis = await loadRunOnboardingAnalysis();

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

  expect(projectAtCap.summariser.calls()).toBe(0);

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

test("a path that reaches a model without a claim fails this suite", async () => {
  const runOnboardingAnalysis = await loadRunOnboardingAnalysis();

  const run = harness({
    projectCap: 1,
    summariser: retryableFailureSummariser(),
  });
  run.setLane(PROJECT, lane({ candidates: [CANDIDATE_A, CANDIDATE_B] }));

  await runOnboardingAnalysis(run.deps, { projectId: PROJECT });

  const claims = run.runs.claimed().length;

  expect(run.summariser.calls()).toBeLessThanOrEqual(claims);

  expect(claims).toBe(1);
});

test("a project with a run already open is an ordinary outcome, not an error", async () => {
  const runOnboardingAnalysis = await loadRunOnboardingAnalysis();

  const run = harness();

  const incumbentId = run.runs.seedRunning({
    organizationId: ORG,
    projectId: PROJECT,
    startedAt: new Date(AT.getTime() - 60_000),
  });
  run.setLane(PROJECT, lane());

  await runOnboardingAnalysis(run.deps, { projectId: PROJECT });

  expect(run.runs.rows()).toHaveLength(1);
  expect(run.runs.rows()[0]?.id).toBe(incumbentId);

  expect(run.runs.closes()).toEqual([]);
  expect(run.runs.rows()[0]?.status).toBe("running");
});

test("the trigger fired twice for one project produces one run and one finding", async () => {
  const runOnboardingAnalysis = await loadRunOnboardingAnalysis();

  const run = harness();
  run.setLane(PROJECT, lane());

  await runOnboardingAnalysis(run.deps, { projectId: PROJECT });
  await runOnboardingAnalysis(run.deps, { projectId: PROJECT });

  expect(run.findings.rows()).toHaveLength(1);
  expect(run.findings.rows()[0]?.signature).toBe(signatureOf(PROJECT, CANDIDATE_A));

  expect(run.runs.claimed()).toHaveLength(1);

  for (const row of run.runs.rows()) {
    expect(row.status).not.toBe("running");
  }
});

test("every exit path records a terminal completed or failed", async () => {
  const runOnboardingAnalysis = await loadRunOnboardingAnalysis();

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

test("a lane that throws mid-walk closes its run as failed with a reason", async () => {
  const runOnboardingAnalysis = await loadRunOnboardingAnalysis();

  const run = harness();
  run.findings.breakOn(signatureOf(PROJECT, CANDIDATE_A));
  run.setLane(PROJECT, lane());

  await runOnboardingAnalysis(run.deps, { projectId: PROJECT });

  const [closed] = run.runs.closes();
  expect(closed).toBeDefined();
  expect(closed?.status).toBe("failed");

  expect(closed?.stopReason).toBe("fatal_error");
  expect(run.runs.rows().every((row) => row.status !== "running")).toBe(true);
});

test("an abandoned running row older than the lease is reclaimed", async () => {
  const runOnboardingAnalysis = await loadRunOnboardingAnalysis();

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

  const past = harness();
  past.runs.seedRunning({
    organizationId: ORG,
    projectId: PROJECT,
    startedAt: new Date(AT.getTime() - (ANALYSIS_RUN_LEASE_MS + 60_000)),
  });
  past.setLane(PROJECT, lane());
  await runOnboardingAnalysis(past.deps, { projectId: PROJECT });

  expect(past.runs.rows().length).toBeGreaterThan(1);
  expect(past.runs.rows().filter((row) => row.status === "running")).toEqual([]);
  expect(past.findings.rows()).toHaveLength(1);
});

test("a trigger that cannot run degrades to the hourly cron, never to silence", async () => {
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

  expect(withoutTrigger.summary).toEqual(alsoWithoutTrigger.summary);
  expect(withoutTrigger.findings).toBe(alsoWithoutTrigger.findings);
  expect(withoutTrigger.findings).toBe(1);
  expect(withoutTrigger.closes.map((row) => row.status)).toEqual(["completed"]);
});

test("the trigger writes no marker that suppresses or reschedules the hourly run", () => {
  expect(suppressionMarkersIn(PLANTED_SUPPRESSION)).toEqual(["next_analysis_at"]);
  expect(suppressionMarkersIn(CLEAN_TRIGGER)).toEqual([]);

  const source = readSourceUnderConstruction({
    repoRelativePath: TRIGGER_SOURCE_PATH,
    ownedBy: OWNER_TRIGGER,
  });

  expect(suppressionMarkersIn(source)).toEqual([]);
});

// The guard this replaces was a source scan: it found the FIRST `requestForProject`
// — the interface declaration — then matched any `try {` before it and any `catch`
// after it anywhere in the file. Unrelated blocks satisfied both, so it passed
// whatever the call site did. The behaviour it meant to pin is asserted for real in
// onboarding-trigger-wire.test.ts ("a failing trigger leaves the poll run completed
// and the watermark advanced"); this covers the mechanism that now carries it.
test("a side effect that throws is logged with its cause and does not reach the caller", async () => {
  const lines: string[] = [];
  const logger = {
    info: () => undefined,
    warn: () => undefined,
    error: (message: string) => void lines.push(message),
  };

  const survived = await isolated(logger, "session source poll: the badge did not update", () => {
    throw new Error("o13-badge-write-refused");
  });

  expect(survived).toBe(false);
  expect(lines.length).toBe(1);

  // The sentence a person reads, and the cause an engineer needs, in one line.
  expect(lines[0]).toContain("the badge did not update");
  expect(lines[0]).toContain("o13-badge-write-refused");
});

test("a side effect that succeeds logs nothing and reports success", async () => {
  const lines: string[] = [];
  const logger = {
    info: () => undefined,
    warn: () => undefined,
    error: (message: string) => void lines.push(message),
  };

  let ran = false;
  const survived = await isolated(logger, "session source poll: unused sentence", async () => {
    ran = true;
  });

  expect(survived).toBe(true);
  expect(ran).toBe(true);
  expect(lines).toEqual([]);
});
