import {
  EVIDENCE_SHAPE_VERSION,
  GATE_REASON_MESSAGES,
  PROOF_PREDICATE_VERSION,
  SIGNATURE_TUPLE_VERSION,
  THRESHOLD_RULE_SET_VERSION,
  candidateFindingSchema,
  measuredCount,
} from "@growthmind/core";
import type { CandidateFinding, MeasuredCount, TraceEntry } from "@growthmind/core";
import { computeFindingSignature } from "@growthmind/db";
import type {
  ClaimModelCallResult,
  DivergencePointRecord,
  DivergencePointsRepo,
  RecordDivergenceInput,
  RecordingSummariesRepo,
  SessionRecordingCitation,
} from "@growthmind/db";
import { CAUSE_STAGE_D11_FIXTURE } from "@growthmind/db/testing";
import type { TenantContext } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import {
  loadUnderConstruction,
  underConstructionSpecifier,
} from "../../../packages/shared/__tests__/onboarding/module-under-construction";
import type {
  AnalysisLane,
  AnalysisLaneDeps,
  AnalysisLogger,
  CandidateIdentity,
} from "../../src/analysis/types";
import { tenantContextFor } from "../../src/analysis/types";

// Wave 0 contract shapes (ADD tasks/o-044-cause-stage-citation-gate/add.md, Decisions 2, 3, 4,
// 5, 7). Production types arrive with worker/src/analysis/cause.ts and its dependencies
// (packages/db/src/repositories/cause-claims.repo.ts, packages/core/src/replay/beats.ts,
// packages/core/src/cause/{guard,citation-gate}.ts, packages/adapters/src/model/cause.ts) —
// Wave 1+. Every symbol below is a stand-in that mirrors the ADD's own stated shape.
const CAUSE_STAGE_OWNER =
  "backend-execution-agent, Wave 1+ (worker/src/analysis/cause.ts, ADD Decision 7)";

type ModelCallStage = "render" | "cause";

interface ClaimModelCallWithStageInput {
  readonly projectId: string;
  readonly runId: string;
  readonly signature: string;
  readonly signatureVersion: number;
  readonly projectCap: number;
  readonly organizationCap: number;
  readonly at: Date;
  readonly stage: ModelCallStage;
}

interface StageAwareAnalysisRunsRepo {
  claimModelCall(input: ClaimModelCallWithStageInput): Promise<ClaimModelCallResult>;
}

interface CauseClaimStatement {
  readonly statement: string;
  readonly citesBeats: readonly number[];
}

interface PersistCauseClaimsInput {
  readonly projectId: string;
  readonly findingId: string;
  readonly anchorSessionId: string;
  readonly claims: readonly CauseClaimStatement[];
  readonly droppedClaims: number;
  readonly resolvedModelId: string | null;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
}

interface CauseClaimRecord extends PersistCauseClaimsInput {
  readonly id: string;
  readonly organizationId: string;
  readonly createdAt: Date;
}

interface CauseClaimsRepo {
  persist(input: PersistCauseClaimsInput): Promise<CauseClaimRecord>;

  findForFinding(projectId: string, findingId: string): Promise<CauseClaimRecord | null>;

  findForFindings(
    projectId: string,
    findingIds: readonly string[],
  ): Promise<ReadonlyMap<string, CauseClaimRecord>>;
}

interface CauseExplainInput {
  readonly surface: string;
  readonly succeededCohortSize: number;
  readonly failedCohortSize: number;
  readonly divergedAtRank: number;
  readonly beats: readonly { index: number; kind: string; text: string }[];
}

type CauseRenderResult =
  | {
      readonly ok: true;
      readonly claims: readonly CauseClaimStatement[];
      readonly resolvedModelId: string;
      readonly usage: Record<string, number>;
    }
  | {
      readonly ok: false;
      readonly code: "output_invalid" | "call_failed";
      readonly message: string;
      readonly resolvedModelId: string;
      readonly usage: Record<string, number>;
    };

interface CauseExplainer {
  explain(input: CauseExplainInput): Promise<CauseRenderResult>;
}

interface ConfiguredCauseExplainer {
  readonly port: CauseExplainer;
  readonly resolvedModelId: string;
}

// O-045 ADD Decision 5: divergence_points now holds one row per cohort cut, so the lookup the
// cause stage binds to has to name the surface-level cut rather than the most recent row for
// the surface. The mirrors below stand in for packages/shared's COHORT_CUTS until Wave 4.
const SURFACE_COHORT_CUT_MIRROR = "surface";
const BROWSER_UNKNOWN_CUT_MIRROR = "browser:unknown";

type CutAwareDivergencePointRecord = DivergencePointRecord & { readonly cohortCut: string };

interface DivergenceLookups extends DivergencePointsRepo {
  findSurfaceCut(projectId: string, surface: string): Promise<CutAwareDivergencePointRecord | null>;
}

// AnalysisLaneDeps gains causeExplainer/causeClaimsFor/divergencePointsFor per the ADD's own
// Decision 7 Impact list. recordingSummariesFor is not named there — Decision 4 requires a
// citationsFor call at this call site, so it is carried here as the same shape of dependency
// until Wave 1 settles exactly where it is threaded from.
type CauseAnalysisLaneDeps = Omit<AnalysisLaneDeps, "divergencePointsFor"> & {
  readonly causeExplainer: ConfiguredCauseExplainer | null;
  readonly causeClaimsFor: (ctx: TenantContext) => CauseClaimsRepo;
  readonly divergencePointsFor: (ctx: TenantContext) => DivergenceLookups;
  readonly recordingSummariesFor: (
    ctx: TenantContext,
  ) => Pick<RecordingSummariesRepo, "citationsFor">;
};

type PlanCause = (
  deps: CauseAnalysisLaneDeps,
  lane: AnalysisLane,
  runs: StageAwareAnalysisRunsRepo,
  causeClaims: CauseClaimsRepo,
  divergencePoints: DivergenceLookups,
  findingId: string,
  identity: CandidateIdentity,
  candidate: CandidateFinding,
  tickAt: Date,
) => Promise<void>;

const loadPlanCause = (): Promise<PlanCause> =>
  loadUnderConstruction<PlanCause>({
    modulePath: underConstructionSpecifier("worker/src/analysis/cause.ts"),
    exportName: "planCause",
    ownedBy: CAUSE_STAGE_OWNER,
  });

// ---------------------------------------------------------------------------------------------

const TICK_AT = new Date("2026-08-06T09:00:00.000Z");
const WINDOW_START = new Date("2026-07-30T00:00:00.000Z");
const WINDOW_END = new Date("2026-08-06T00:00:00.000Z");
const OTHER_WINDOW_START = new Date("2026-07-23T00:00:00.000Z");
const OTHER_WINDOW_END = new Date("2026-07-30T00:00:00.000Z");

const ORG = "o44-cause-org";
const ORG_NAME = "Acme Cause";
const PROJECT = "o44-cause-project";
const MODEL_ID = "o44-cause-model-under-test";
const SURFACE = "/checkout";
const CAP_WIDE_ENOUGH_TO_NEVER_REFUSE = 10_000;

function lane(overrides: Partial<AnalysisLane> = {}): AnalysisLane {
  return {
    organizationId: ORG,
    organizationName: ORG_NAME,
    projectId: PROJECT,
    candidates: [],
    sessionsConsidered: 42,
    ...overrides,
  };
}

const CTX: TenantContext = tenantContextFor(lane());

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

function count(numerator: number, kept: number): MeasuredCount {
  return measuredCount({
    numerator,
    denominator: kept,
    unit: "sessions",
    timeframe: { start: WINDOW_START, end: WINDOW_END },
    basis: { totalInWindow: kept, kept, keptUnchecked: 0, setAside: [] },
  });
}

const CANDIDATE: CandidateFinding = candidateFindingSchema.parse({
  detector: "funnel_dropoff",
  claimedClass: "confusing",
  finalClass: "confusing",
  trace: trace(),
  counts: [count(28, 28), count(3, 28)],
  timeframe: { start: WINDOW_START, end: WINDOW_END },
  claimSubject: "surface",
  surface: SURFACE,
  surfaceNormalisationVersion: 1,
  evidenceShape: `{"detector":"funnel_dropoff","surface":"${SURFACE}","v":1}`,
  evidenceShapeVersion: EVIDENCE_SHAPE_VERSION,
  thresholdRuleSetVersion: THRESHOLD_RULE_SET_VERSION,
  ranking: { sampleSize: count(3, 28), confidenceBasis: "threshold_met" },
  coverage: { truncated: false, eventsWithoutUrlPath: 0 },
});

const IDENTITY: CandidateIdentity = {
  signature: computeFindingSignature({
    projectId: PROJECT,
    surface: CANDIDATE.surface,
    symptomClass: CANDIDATE.finalClass,
    evidenceShape: CANDIDATE.evidenceShape,
  }),
  signatureVersion: SIGNATURE_TUPLE_VERSION,
};

function divergenceRow(
  overrides: Partial<CutAwareDivergencePointRecord> = {},
): CutAwareDivergencePointRecord {
  return {
    id: "o44-cause-divergence-row",
    organizationId: ORG,
    projectId: PROJECT,
    surface: SURFACE,
    cohortCut: SURFACE_COHORT_CUT_MIRROR,
    surfaceNormalisationVersion: 1,
    spineVersion: 1,
    cohortMatchVersion: 1,
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    kind: "diverged",
    divergedAtRank: 3,
    reason: null,
    succeededCohortSize: 12,
    failedCohortSize: 8,
    succeededSessionIdsSample: ["session-ok-1", "session-ok-2"],
    failedSessionIdsSample: ["session-bad-1", "session-bad-2", "session-bad-3", "session-bad-4"],
    createdAt: TICK_AT,
    updatedAt: TICK_AT,
    ...overrides,
  };
}

function readableCitation(
  sessionId: string,
  overrides: Partial<SessionRecordingCitation> = {},
): SessionRecordingCitation {
  return {
    sessionId,
    recordingId: `${sessionId}-recording`,
    provider: "posthog",
    transcriptVersion: 1,
    actions: [
      { kind: "click", atMs: 100, element: { nodeId: 1, tag: "button", classes: ["submit"] } },
      {
        kind: "field_abandoned",
        atMs: 400,
        element: { nodeId: 2, tag: "input", classes: ["email"] },
      },
    ],
    omitted: 0,
    pullStop: null,
    pullReason: null,
    ...overrides,
  };
}

function unreadableCitation(sessionId: string): SessionRecordingCitation {
  return readableCitation(sessionId, { actions: null });
}

// --- fakes ---------------------------------------------------------------------------------

function notThisLane(name: string): () => never {
  return () => {
    throw new Error(`planCause must never call ${name}`);
  };
}

interface FakeRuns {
  repoFor: (ctx: TenantContext) => StageAwareAnalysisRunsRepo;
  claimAttempts: () => readonly string[];
  claimed: () => readonly string[];
}

function runsClaimKey(organizationId: string, input: ClaimModelCallWithStageInput): string {
  return `${organizationId}|${input.projectId}|${input.signature}|${input.stage}`;
}

function createFakeRuns(): FakeRuns {
  const claims = new Set<string>();
  const attempts: string[] = [];

  return {
    claimAttempts: () => [...attempts],
    claimed: () => [...claims],
    repoFor: (ctx) => ({
      claimModelCall(input: ClaimModelCallWithStageInput): Promise<ClaimModelCallResult> {
        const k = runsClaimKey(ctx.organizationId, input);
        attempts.push(k);
        if (claims.has(k)) {
          return Promise.resolve({ claimed: false, reason: "already_claimed" });
        }
        claims.add(k);
        return Promise.resolve({ claimed: true });
      },
    }),
  };
}

interface FakeCauseClaims {
  repoFor: (ctx: TenantContext) => CauseClaimsRepo;
  rows: () => readonly CauseClaimRecord[];
  rowFor: (findingId: string) => CauseClaimRecord | undefined;
}

function causeClaimsRowKey(organizationId: string, projectId: string, findingId: string): string {
  return `${organizationId}|${projectId}|${findingId}`;
}

function createFakeCauseClaims(): FakeCauseClaims {
  const stored = new Map<string, CauseClaimRecord>();
  let nextId = 1;

  return {
    rows: () => [...stored.values()],
    rowFor: (findingId) => [...stored.values()].find((row) => row.findingId === findingId),
    repoFor: (ctx) => ({
      persist(input: PersistCauseClaimsInput): Promise<CauseClaimRecord> {
        const k = causeClaimsRowKey(ctx.organizationId, input.projectId, input.findingId);
        const existing = stored.get(k);
        if (existing) return Promise.resolve(existing);

        const row: CauseClaimRecord = {
          ...input,
          id: `o44-cause-claim-${String(nextId)}`,
          organizationId: ctx.organizationId,
          createdAt: TICK_AT,
        };
        nextId += 1;
        stored.set(k, row);
        return Promise.resolve(row);
      },
      findForFinding(projectId: string, findingId: string): Promise<CauseClaimRecord | null> {
        return Promise.resolve(
          stored.get(causeClaimsRowKey(ctx.organizationId, projectId, findingId)) ?? null,
        );
      },
      findForFindings(
        projectId: string,
        findingIds: readonly string[],
      ): Promise<ReadonlyMap<string, CauseClaimRecord>> {
        const found = new Map<string, CauseClaimRecord>();
        for (const findingId of findingIds) {
          const row = stored.get(causeClaimsRowKey(ctx.organizationId, projectId, findingId));
          if (row) found.set(findingId, row);
        }
        return Promise.resolve(found);
      },
    }),
  };
}

interface FakeDivergencePoints {
  repoFor: (ctx: TenantContext) => DivergenceLookups;
  seed: (row: CutAwareDivergencePointRecord) => void;
}

// Backed by an array, not one hand-built row: a single-row fake cannot tell the surface-level
// row apart from a bucket row written after it, which is the whole of ADD Decision 5.
// findSurfaceCut narrows to the surface sentinel first, then mirrors the repository's real
// `order by created_at desc limit 1`.
function mostRecentRow(
  candidates: readonly CutAwareDivergencePointRecord[],
): CutAwareDivergencePointRecord | null {
  return candidates.toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
}

function createFakeDivergencePoints(): FakeDivergencePoints {
  const rows: CutAwareDivergencePointRecord[] = [];

  const forSurface = (
    organizationId: string,
    projectId: string,
    surface: string,
  ): readonly CutAwareDivergencePointRecord[] =>
    rows.filter(
      (row) =>
        row.organizationId === organizationId &&
        row.projectId === projectId &&
        row.surface === surface,
    );

  return {
    seed: (row) => {
      rows.push(row);
    },
    repoFor: (ctx) => ({
      recordDivergence(_input: RecordDivergenceInput): Promise<DivergencePointRecord> {
        return notThisLane("recordDivergence")();
      },
      findSurfaceCut(
        projectId: string,
        surface: string,
      ): Promise<CutAwareDivergencePointRecord | null> {
        return Promise.resolve(
          mostRecentRow(
            forSurface(ctx.organizationId, projectId, surface).filter(
              (row) => row.cohortCut === SURFACE_COHORT_CUT_MIRROR,
            ),
          ),
        );
      },
    }),
  };
}

interface FakeRecordingSummaries {
  repoFor: (ctx: TenantContext) => Pick<RecordingSummariesRepo, "citationsFor">;
  seed: (citation: SessionRecordingCitation) => void;
  calls: () => readonly (readonly string[])[];
}

function createFakeRecordingSummaries(): FakeRecordingSummaries {
  const bySessionId = new Map<string, SessionRecordingCitation>();
  const calls: (readonly string[])[] = [];

  return {
    seed: (citation) => {
      bySessionId.set(citation.sessionId, citation);
    },
    calls: () => calls.map((entry) => [...entry]),
    repoFor: () => ({
      citationsFor(
        _projectId: string,
        sessionIds: readonly string[],
      ): Promise<readonly SessionRecordingCitation[]> {
        calls.push(sessionIds);
        const found = sessionIds
          .map((id) => bySessionId.get(id))
          .filter((citation): citation is SessionRecordingCitation => citation !== undefined);
        return Promise.resolve(found);
      },
    }),
  };
}

type CauseBehaviour = (input: CauseExplainInput) => CauseRenderResult | Promise<CauseRenderResult>;

interface FakeExplainer {
  port: CauseExplainer;
  calls: () => readonly CauseExplainInput[];
}

function createFakeExplainer(behaviour: CauseBehaviour): FakeExplainer {
  const seen: CauseExplainInput[] = [];
  return {
    calls: () => [...seen],
    port: {
      explain(input: CauseExplainInput): Promise<CauseRenderResult> {
        seen.push(input);
        return Promise.resolve(behaviour(input));
      },
    },
  };
}

function causeOk(claims: readonly CauseClaimStatement[]): CauseRenderResult {
  return {
    ok: true,
    claims,
    resolvedModelId: MODEL_ID,
    usage: { inputTokens: 300, outputTokens: 60 },
  };
}

function recordingLogger(sink: string[]): AnalysisLogger {
  return {
    info: (message: string) => sink.push(message),
    warn: (message: string) => sink.push(message),
    error: (message: string) => sink.push(message),
  };
}

interface Harness {
  deps: CauseAnalysisLaneDeps;
  runs: FakeRuns;
  causeClaims: FakeCauseClaims;
  divergencePoints: FakeDivergencePoints;
  recordingSummaries: FakeRecordingSummaries;
  explainer: FakeExplainer | null;
  logs: () => readonly string[];
}

function harness(options: { explainerBehaviour?: CauseBehaviour | null; cap?: number }): Harness {
  const runs = createFakeRuns();
  const causeClaims = createFakeCauseClaims();
  const divergencePoints = createFakeDivergencePoints();
  const recordingSummaries = createFakeRecordingSummaries();
  const sink: string[] = [];

  const behaviour = options.explainerBehaviour;
  const explainer =
    behaviour === null ? null : createFakeExplainer(behaviour ?? (() => causeOk([])));

  return {
    runs,
    causeClaims,
    divergencePoints,
    recordingSummaries,
    explainer,
    logs: () => [...sink],
    deps: {
      summariser: null,
      findingsFor: notThisLane("findingsFor"),
      payloadsFor: notThisLane("payloadsFor"),
      runsFor: notThisLane("runsFor (planCause receives its runs repo positionally)"),
      ledgerFor: notThisLane("ledgerFor"),
      projectCap: options.cap ?? CAP_WIDE_ENOUGH_TO_NEVER_REFUSE,
      organizationCap: CAP_WIDE_ENOUGH_TO_NEVER_REFUSE,
      now: () => TICK_AT,
      logger: recordingLogger(sink),
      causeExplainer:
        explainer === null ? null : { port: explainer.port, resolvedModelId: MODEL_ID },
      causeClaimsFor: causeClaims.repoFor,
      divergencePointsFor: divergencePoints.repoFor,
      recordingSummariesFor: recordingSummaries.repoFor,
    },
  };
}

const FINDING_ID = "o44-cause-finding";

// SHARED_D11_FIXTURE is now CAUSE_STAGE_D11_FIXTURE, exported from @growthmind/db/testing —
// see that module for why (the same constant drives detail-gate-emptied.test.ts's consumer
// half of this D11 wiring proof; two hand-copied literals could silently drift apart).
const SHARED_D11_FIXTURE = CAUSE_STAGE_D11_FIXTURE;

describe("planCause", () => {
  test("does not attempt the cause stage when the divergence row's kind is no_divergence or refused", async () => {
    const planCause = await loadPlanCause();

    for (const [kind, reason] of [
      ["no_divergence", "no_gap_found"],
      ["refused", "cohort_below_floor"],
    ] as const) {
      const h = harness({});
      h.divergencePoints.seed(divergenceRow({ kind, divergedAtRank: null, reason }));

      await planCause(
        h.deps,
        lane(),
        h.runs.repoFor(CTX),
        h.causeClaims.repoFor(CTX),
        h.divergencePoints.repoFor(CTX),
        FINDING_ID,
        IDENTITY,
        CANDIDATE,
        TICK_AT,
      );

      expect(h.runs.claimAttempts()).toEqual([]);
      expect(h.causeClaims.rows()).toEqual([]);
      expect(h.recordingSummaries.calls()).toEqual([]);
    }
  });

  test("does not attempt the cause stage when the divergence row's window does not match the candidate's own window", async () => {
    const planCause = await loadPlanCause();
    const h = harness({});
    h.divergencePoints.seed(
      divergenceRow({ windowStart: OTHER_WINDOW_START, windowEnd: OTHER_WINDOW_END }),
    );

    await planCause(
      h.deps,
      lane(),
      h.runs.repoFor(CTX),
      h.causeClaims.repoFor(CTX),
      h.divergencePoints.repoFor(CTX),
      FINDING_ID,
      IDENTITY,
      CANDIDATE,
      TICK_AT,
    );

    expect(h.runs.claimAttempts()).toEqual([]);
    expect(h.causeClaims.rows()).toEqual([]);
    expect(h.recordingSummaries.calls()).toEqual([]);
  });

  test("tries up to 3 failed-cohort sessions and anchors on the first with a readable transcript", async () => {
    const planCause = await loadPlanCause();
    const h = harness({
      explainerBehaviour: () =>
        causeOk([
          {
            statement: "The record stalled here because the field was left blank.",
            citesBeats: [0],
          },
        ]),
    });
    h.divergencePoints.seed(
      divergenceRow({
        failedSessionIdsSample: [
          "session-bad-1",
          "session-bad-2",
          "session-bad-3",
          "session-bad-4",
        ],
      }),
    );
    h.recordingSummaries.seed(unreadableCitation("session-bad-1"));
    h.recordingSummaries.seed(unreadableCitation("session-bad-2"));
    h.recordingSummaries.seed(readableCitation("session-bad-3"));

    await planCause(
      h.deps,
      lane(),
      h.runs.repoFor(CTX),
      h.causeClaims.repoFor(CTX),
      h.divergencePoints.repoFor(CTX),
      FINDING_ID,
      IDENTITY,
      CANDIDATE,
      TICK_AT,
    );

    expect(h.recordingSummaries.calls()).toEqual([
      ["session-bad-1", "session-bad-2", "session-bad-3"],
    ]);

    const row = h.causeClaims.rowFor(FINDING_ID);
    expect(row?.anchorSessionId).toBe("session-bad-3");
  });

  test("attempts nothing and spends no cap-ledger claim when none of the first 3 failed-cohort sessions has a readable transcript", async () => {
    const planCause = await loadPlanCause();
    const h = harness({
      explainerBehaviour: () => causeOk([{ statement: "Never reached.", citesBeats: [0] }]),
    });
    h.divergencePoints.seed(
      divergenceRow({
        failedSessionIdsSample: [
          "session-bad-1",
          "session-bad-2",
          "session-bad-3",
          "session-bad-4",
        ],
      }),
    );
    h.recordingSummaries.seed(unreadableCitation("session-bad-1"));
    h.recordingSummaries.seed(unreadableCitation("session-bad-2"));
    h.recordingSummaries.seed(unreadableCitation("session-bad-3"));
    h.recordingSummaries.seed(readableCitation("session-bad-4"));

    await planCause(
      h.deps,
      lane(),
      h.runs.repoFor(CTX),
      h.causeClaims.repoFor(CTX),
      h.divergencePoints.repoFor(CTX),
      FINDING_ID,
      IDENTITY,
      CANDIDATE,
      TICK_AT,
    );

    expect(h.runs.claimAttempts()).toEqual([]);
    expect(h.causeClaims.rows()).toEqual([]);
  });

  test("a cause-stage explainer that throws never blocks planCause and writes no cause_claims row", async () => {
    const planCause = await loadPlanCause();
    const h = harness({
      explainerBehaviour: () => {
        throw new Error("o44-cause-explainer-boom");
      },
    });
    h.divergencePoints.seed(divergenceRow());
    h.recordingSummaries.seed(readableCitation("session-bad-1"));

    await expect(
      planCause(
        h.deps,
        lane(),
        h.runs.repoFor(CTX),
        h.causeClaims.repoFor(CTX),
        h.divergencePoints.repoFor(CTX),
        FINDING_ID,
        IDENTITY,
        CANDIDATE,
        TICK_AT,
      ),
    ).resolves.toBeUndefined();

    expect(h.causeClaims.rows()).toEqual([]);
    expect(h.runs.claimed()).toEqual([`${ORG}|${PROJECT}|${IDENTITY.signature}|cause`]);
  });

  test("a §6-prohibited cause response (bare digit) is refused end to end, finding stays described, no row", async () => {
    const planCause = await loadPlanCause();
    const h = harness({
      explainerBehaviour: () => causeOk([{ statement: "This happened 3 times.", citesBeats: [0] }]),
    });
    h.divergencePoints.seed(divergenceRow());
    h.recordingSummaries.seed(readableCitation("session-bad-1"));

    await planCause(
      h.deps,
      lane(),
      h.runs.repoFor(CTX),
      h.causeClaims.repoFor(CTX),
      h.divergencePoints.repoFor(CTX),
      FINDING_ID,
      IDENTITY,
      CANDIDATE,
      TICK_AT,
    );

    expect(h.causeClaims.rows()).toEqual([]);
    expect(h.runs.claimed()).toEqual([`${ORG}|${PROJECT}|${IDENTITY.signature}|cause`]);
  });

  test("an empty claims: [] cause response leaves the finding described with NO cause_claims row", async () => {
    const planCause = await loadPlanCause();
    const h = harness({ explainerBehaviour: () => causeOk([]) });
    h.divergencePoints.seed(divergenceRow());
    h.recordingSummaries.seed(readableCitation("session-bad-1"));

    await planCause(
      h.deps,
      lane(),
      h.runs.repoFor(CTX),
      h.causeClaims.repoFor(CTX),
      h.divergencePoints.repoFor(CTX),
      FINDING_ID,
      IDENTITY,
      CANDIDATE,
      TICK_AT,
    );

    expect(h.causeClaims.rows()).toEqual([]);
  });

  test("a wholly-uncited cause response leaves the finding described but persists a cause_claims row with droppedClaims > 0", async () => {
    const planCause = await loadPlanCause();
    const h = harness({
      explainerBehaviour: () =>
        causeOk([
          {
            statement: "The page failed to load because the request never returned.",
            citesBeats: [],
          },
        ]),
    });
    h.divergencePoints.seed(divergenceRow());
    h.recordingSummaries.seed(readableCitation("session-bad-1"));

    await planCause(
      h.deps,
      lane(),
      h.runs.repoFor(CTX),
      h.causeClaims.repoFor(CTX),
      h.divergencePoints.repoFor(CTX),
      FINDING_ID,
      IDENTITY,
      CANDIDATE,
      TICK_AT,
    );

    const row = h.causeClaims.rowFor(FINDING_ID);
    expect(row).toBeDefined();
    expect(row?.claims).toEqual([]);
    expect(row?.droppedClaims).toBe(1);
  });

  const RESIDUAL_PII_EMAIL = "jane@example.com";

  test("cause-stage text is scanned for residual PII at its own call site before persistence", async () => {
    const planCause = await loadPlanCause();
    const h = harness({
      explainerBehaviour: () =>
        causeOk([
          {
            statement: `The person emailed ${RESIDUAL_PII_EMAIL} because the confirmation link never arrived.`,
            citesBeats: [0],
          },
        ]),
    });
    h.divergencePoints.seed(divergenceRow());
    h.recordingSummaries.seed(readableCitation("session-bad-1"));

    await planCause(
      h.deps,
      lane(),
      h.runs.repoFor(CTX),
      h.causeClaims.repoFor(CTX),
      h.divergencePoints.repoFor(CTX),
      FINDING_ID,
      IDENTITY,
      CANDIDATE,
      TICK_AT,
    );

    expect(h.causeClaims.rows()).toEqual([]);
    for (const line of h.logs()) {
      expect(line).not.toContain(RESIDUAL_PII_EMAIL);
    }
  });

  test("two ticks over the same seeded finding + divergence row produce exactly one cause_claims row", async () => {
    const planCause = await loadPlanCause();
    const h = harness({
      explainerBehaviour: () =>
        causeOk([
          {
            statement: "The page failed to load because the request never returned.",
            citesBeats: [],
          },
        ]),
    });

    const sharedLane = lane({
      organizationId: SHARED_D11_FIXTURE.organizationId,
      organizationName: SHARED_D11_FIXTURE.organizationName,
      projectId: SHARED_D11_FIXTURE.projectId,
    });
    const sharedCtx = tenantContextFor(sharedLane);

    h.divergencePoints.seed(
      divergenceRow({
        organizationId: SHARED_D11_FIXTURE.organizationId,
        projectId: SHARED_D11_FIXTURE.projectId,
        surface: SHARED_D11_FIXTURE.surface,
        windowStart: SHARED_D11_FIXTURE.windowStart,
        windowEnd: SHARED_D11_FIXTURE.windowEnd,
        failedSessionIdsSample: [SHARED_D11_FIXTURE.anchorSessionId],
      }),
    );
    h.recordingSummaries.seed(readableCitation(SHARED_D11_FIXTURE.anchorSessionId));

    const sharedCandidate: CandidateFinding = candidateFindingSchema.parse({
      ...CANDIDATE,
      surface: SHARED_D11_FIXTURE.surface,
    });
    const sharedIdentity: CandidateIdentity = {
      signature: computeFindingSignature({
        projectId: SHARED_D11_FIXTURE.projectId,
        surface: sharedCandidate.surface,
        symptomClass: sharedCandidate.finalClass,
        evidenceShape: sharedCandidate.evidenceShape,
      }),
      signatureVersion: SIGNATURE_TUPLE_VERSION,
    };

    for (let tick = 0; tick < 2; tick += 1) {
      await planCause(
        h.deps,
        sharedLane,
        h.runs.repoFor(sharedCtx),
        h.causeClaims.repoFor(sharedCtx),
        h.divergencePoints.repoFor(sharedCtx),
        SHARED_D11_FIXTURE.findingId,
        sharedIdentity,
        sharedCandidate,
        TICK_AT,
      );
    }

    expect(h.causeClaims.rows()).toHaveLength(1);
    const row = h.causeClaims.rowFor(SHARED_D11_FIXTURE.findingId);
    expect(row?.claims).toEqual([]);
    expect(row?.droppedClaims).toBe(1);
    expect(row?.anchorSessionId).toBe(SHARED_D11_FIXTURE.anchorSessionId);

    expect(h.explainer?.calls()).toHaveLength(1);
    expect(h.runs.claimAttempts()).toEqual([
      `${SHARED_D11_FIXTURE.organizationId}|${SHARED_D11_FIXTURE.projectId}|${sharedIdentity.signature}|cause`,
      `${SHARED_D11_FIXTURE.organizationId}|${SHARED_D11_FIXTURE.projectId}|${sharedIdentity.signature}|cause`,
    ]);
    expect(h.runs.claimed()).toEqual([
      `${SHARED_D11_FIXTURE.organizationId}|${SHARED_D11_FIXTURE.projectId}|${sharedIdentity.signature}|cause`,
    ]);
  });
});

const SURFACE_ROW_CREATED_AT = new Date("2026-08-06T08:58:00.000Z");
const BUCKET_ROW_CREATED_AT = new Date("2026-08-06T08:59:00.000Z");

const SURFACE_SUCCEEDED_COHORT_SIZE = 12;
const SURFACE_FAILED_COHORT_SIZE = 8;
const SURFACE_DIVERGED_AT_RANK = 3;

const BUCKET_SUCCEEDED_COHORT_SIZE = 2;
const BUCKET_FAILED_COHORT_SIZE = 3;

function seedSurfaceAndRefusedBucket(h: Harness): void {
  h.divergencePoints.seed(
    divergenceRow({
      id: "o45-surface-cut-row",
      cohortCut: SURFACE_COHORT_CUT_MIRROR,
      kind: "diverged",
      reason: null,
      divergedAtRank: SURFACE_DIVERGED_AT_RANK,
      succeededCohortSize: SURFACE_SUCCEEDED_COHORT_SIZE,
      failedCohortSize: SURFACE_FAILED_COHORT_SIZE,
      createdAt: SURFACE_ROW_CREATED_AT,
      updatedAt: SURFACE_ROW_CREATED_AT,
    }),
  );

  h.divergencePoints.seed(
    divergenceRow({
      id: "o45-browser-unknown-cut-row",
      cohortCut: BROWSER_UNKNOWN_CUT_MIRROR,
      kind: "refused",
      reason: "cohort_below_floor",
      divergedAtRank: null,
      succeededCohortSize: BUCKET_SUCCEEDED_COHORT_SIZE,
      failedCohortSize: BUCKET_FAILED_COHORT_SIZE,
      createdAt: BUCKET_ROW_CREATED_AT,
      updatedAt: BUCKET_ROW_CREATED_AT,
    }),
  );

  h.recordingSummaries.seed(readableCitation("session-bad-1"));
}

describe("planCause — the surface-level row is what the cause stage binds to (O-045, ADD Decision 5)", () => {
  test("the explainer is called once and receives the surface row's denominators, never a bucket's", async () => {
    const planCause = await loadPlanCause();
    const h = harness({
      explainerBehaviour: () =>
        causeOk([
          {
            statement: "The record stalled here because the field was left blank.",
            citesBeats: [0],
          },
        ]),
    });
    seedSurfaceAndRefusedBucket(h);

    await planCause(
      h.deps,
      lane(),
      h.runs.repoFor(CTX),
      h.causeClaims.repoFor(CTX),
      h.divergencePoints.repoFor(CTX),
      FINDING_ID,
      IDENTITY,
      CANDIDATE,
      TICK_AT,
    );

    expect(h.explainer?.calls()).toHaveLength(1);

    const call = h.explainer?.calls()[0];
    expect([
      call?.surface,
      call?.succeededCohortSize,
      call?.failedCohortSize,
      call?.divergedAtRank,
    ]).toEqual([
      SURFACE,
      SURFACE_SUCCEEDED_COHORT_SIZE,
      SURFACE_FAILED_COHORT_SIZE,
      SURFACE_DIVERGED_AT_RANK,
    ]);
  });

  test("a refused bucket row does not stop the finding being explained", async () => {
    const planCause = await loadPlanCause();
    const h = harness({
      explainerBehaviour: () =>
        causeOk([
          {
            statement: "The record stalled here because the field was left blank.",
            citesBeats: [0],
          },
        ]),
    });
    seedSurfaceAndRefusedBucket(h);

    await planCause(
      h.deps,
      lane(),
      h.runs.repoFor(CTX),
      h.causeClaims.repoFor(CTX),
      h.divergencePoints.repoFor(CTX),
      FINDING_ID,
      IDENTITY,
      CANDIDATE,
      TICK_AT,
    );

    expect(h.runs.claimAttempts()).toEqual([`${ORG}|${PROJECT}|${IDENTITY.signature}|cause`]);
    expect(h.runs.claimed()).toEqual([`${ORG}|${PROJECT}|${IDENTITY.signature}|cause`]);
    expect(h.causeClaims.rowFor(FINDING_ID)?.anchorSessionId).toBe("session-bad-1");
  });
});
