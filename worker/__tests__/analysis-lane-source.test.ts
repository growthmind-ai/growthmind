import { randomUUID } from "node:crypto";

import {
  candidateFindingSchema,
  THRESHOLD_RULE_SET_VERSION,
  THRESHOLD_RULE_SETS,
} from "@growthmind/core";
import {
  createDivergencePointsRepo,
  createRecordingSummariesRepo,
  type DivergenceService,
} from "@growthmind/db";
import {
  createTestDb,
  scannedTextFor,
  seedEvents,
  seedSession,
  type TestDb,
} from "@growthmind/db/testing";
import {
  recordingSessionKey,
  SESSION_GROUPING_VERSION,
  type TenantContext,
} from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  ANALYSIS_WINDOW_MS,
  createAnalysisLaneSource,
  type AnalysisLaneSourceDeps,
} from "../src/analysis-lane-source";
import type { AnalysisLogger } from "../src/tasks/analysis-tick";
import { seedPollableWorkspace, type SeededWorkspace } from "./helpers/wire-fixtures";

const NOW = new Date("2026-07-08T00:00:00.000Z");

const IN_WINDOW_AT = new Date("2026-07-03T09:00:00.000Z");

const BEFORE_WINDOW_AT = new Date(NOW.getTime() - ANALYSIS_WINDOW_MS - 60 * 60 * 1_000);

const ORIGIN = "/pricing";
const DESTINATION = "/checkout";
const DETOUR = "/faq";
const NORMALISATION_VERSION = 1;

const SESSION_STRIDE_MS = 60_000;
const EVENT_STRIDE_MS = 1_000;

let db: TestDb;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

function recordingLogger(): AnalysisLogger & { readonly lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    info: (message: string) => void lines.push(message),
    warn: (message: string) => void lines.push(message),
    error: (message: string) => void lines.push(message),
  };
}

async function persistPathSession(
  workspace: SeededWorkspace,
  paths: readonly string[],
  startedAt: Date,
): Promise<void> {
  const key = randomUUID();
  const session = await seedSession(db, {
    organizationId: workspace.organizationId,
    projectId: workspace.projectId,
    connectionId: workspace.connectionId,
    sessionKey: `ph:o012-${key}`,
    entryUrlPath: paths[0] ?? null,
    startedAt,
    lastEventAt: new Date(startedAt.getTime() + (paths.length - 1) * EVENT_STRIDE_MS),
  });

  await seedEvents(
    db,
    paths.map((urlPath, index) => ({
      organizationId: workspace.organizationId,
      projectId: workspace.projectId,
      connectionId: workspace.connectionId,
      sessionId: session.id,
      sourceEventId: `o012-${key}-e${String(index).padStart(3, "0")}`,
      name: `step_${String(index)}`,
      occurredAt: new Date(startedAt.getTime() + index * EVENT_STRIDE_MS),
      urlPath,
      urlPathNormalisationVersion: NORMALISATION_VERSION,
    })),
  );
}

async function persistCohort(
  workspace: SeededWorkspace,
  count: number,
  paths: readonly string[],
  firstStartedAt: Date,
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await persistPathSession(
      workspace,
      paths,
      new Date(firstStartedAt.getTime() + index * SESSION_STRIDE_MS),
    );
  }
}

function currentRules() {
  const rules = THRESHOLD_RULE_SETS.get(THRESHOLD_RULE_SET_VERSION);
  if (!rules) {
    throw new Error(`no threshold rule set registered for ${String(THRESHOLD_RULE_SET_VERSION)}`);
  }
  return rules;
}

// A rage-click burst on the same surface, replayed for enough sessions to clear
// struggleObservedMinSessions — the corpus.replays half of the O-041 wiring gap.
async function persistStrugglingSession(
  workspace: SeededWorkspace,
  surface: string,
  clicks: number,
  startedAt: Date,
): Promise<void> {
  const recordingId = randomUUID();
  const sessionKey = recordingSessionKey("posthog", recordingId);
  if (sessionKey === null) {
    throw new Error(`recordingSessionKey returned no key for ${recordingId}`);
  }

  await seedSession(db, {
    organizationId: workspace.organizationId,
    projectId: workspace.projectId,
    connectionId: workspace.connectionId,
    sessionKey,
    entryUrlPath: surface,
    startedAt,
  });

  const text = scannedTextFor("Someone struggled on this step", [
    "They clicked the same control repeatedly and never continued.",
  ]);

  await createRecordingSummariesRepo(db, workspace.ownerCtx).persist({
    projectId: workspace.projectId,
    recordingId,
    summarySource: "model_rendered",
    headline: text.headline,
    context: text.context,
    transcript: "0:00  rage-clicked the button",
    pages: [surface],
    durationMs: 5_000,
    actionCount: 2,
    notableCount: 1,
    droppedEvents: 0,
    startedAt,
    resolvedModelId: "test-model",
    provider: "posthog",
    sessionKey,
    sessionGroupingVersion: SESSION_GROUPING_VERSION,
    actions: {
      v: 1,
      actions: [
        { kind: "page", atMs: 0, href: `https://o046.example.invalid${surface}` },
        {
          kind: "rage_click",
          atMs: 2_000,
          element: { nodeId: 1, tag: "BUTTON", classes: ["gm-buy"] },
          clicks,
          spanMs: 900,
        },
      ],
    },
    actionsVersion: 1,
    actionsOmitted: 0,
    pullStop: "exhausted",
    pullReason: null,
    pullWatermarkAt: null,
  });
}

describe("createAnalysisLaneSource — persisted events to a CandidateFinding ( e2e)", () => {
  test("drives persisted sessions and events through corpus, detectors and gate into one lane's CandidateFinding", async () => {
    const workspace = await seedPollableWorkspace(db, { prefix: "o012a-", now: NOW });

    await persistCohort(workspace, 3, [ORIGIN, DETOUR, ORIGIN, DETOUR, ORIGIN], IN_WINDOW_AT);
    await persistCohort(
      workspace,
      12,
      [ORIGIN],
      new Date(IN_WINDOW_AT.getTime() + 60 * 60 * 1_000),
    );
    await persistCohort(
      workspace,
      15,
      [ORIGIN, DESTINATION],
      new Date(IN_WINDOW_AT.getTime() + 2 * 60 * 60 * 1_000),
    );

    await persistPathSession(workspace, [ORIGIN], BEFORE_WINDOW_AT);

    const logger = recordingLogger();
    const source = createAnalysisLaneSource({ db, logger });

    const lanes = await source.listDueLanes(NOW);
    const lane = lanes.find((candidate) => candidate.projectId === workspace.projectId);
    if (lane === undefined) throw new Error("expected a lane for the seeded project");

    expect(lane.organizationId).toBe(workspace.organizationId);
    expect(lane.organizationName).toBe(workspace.organizationName);

    expect(lane.sessionsConsidered).toBe(30);

    expect(lane.candidates.length).toBe(1);
    const finding = lane.candidates[0];
    if (finding === undefined) throw new Error("asserted one candidate above");

    expect(() => candidateFindingSchema.parse(finding)).not.toThrow();
    expect(finding.detector).toBe("funnel_dropoff");
    expect(finding.finalClass).toBe("confusing");
    expect(finding.surface).toBe(ORIGIN);
    expect(finding.ranking.confidenceBasis).toBe("at_threshold");

    expect(finding.ranking.sampleSize.denominator).toBe(30);
  });

  test("replaying the same tick instant rebuilds identical lanes — no clock reaches the producer", async () => {
    const logger = recordingLogger();
    const source = createAnalysisLaneSource({ db, logger });

    const first = await source.listDueLanes(NOW);
    const second = await source.listDueLanes(NOW);

    expect(second).toEqual(first);
  });

  test("a project whose connection is inactive is not analysed ( — the selection is explicit)", async () => {
    const workspace = await seedPollableWorkspace(db, {
      prefix: "o012b-",
      now: NOW,
      isActive: false,
    });
    await persistCohort(workspace, 3, [ORIGIN, DESTINATION], IN_WINDOW_AT);

    const source = createAnalysisLaneSource({ db, logger: recordingLogger() });
    const lanes = await source.listDueLanes(NOW);

    expect(lanes.some((lane) => lane.projectId === workspace.projectId)).toBe(false);
  });

  test("a connected project with no sessions yields a lane with sessionsConsidered 0, never a crash", async () => {
    const workspace = await seedPollableWorkspace(db, { prefix: "o012c-", now: NOW });

    const source = createAnalysisLaneSource({ db, logger: recordingLogger() });
    const lanes = await source.listDueLanes(NOW);
    const lane = lanes.find((candidate) => candidate.projectId === workspace.projectId);
    if (lane === undefined) throw new Error("expected a lane for the empty project");

    expect(lane.sessionsConsidered).toBe(0);
    expect(lane.candidates).toEqual([]);
  });

  test("one project's contract violation is contained: the sibling's lane survives and the skip is logged", async () => {
    const RAW_ORIGIN = "/PRICING";
    const poisoned = await seedPollableWorkspace(db, { prefix: "o012e-", now: NOW });
    await persistCohort(
      poisoned,
      3,
      [RAW_ORIGIN, DETOUR, RAW_ORIGIN, DETOUR, RAW_ORIGIN],
      IN_WINDOW_AT,
    );
    await persistCohort(
      poisoned,
      12,
      [RAW_ORIGIN],
      new Date(IN_WINDOW_AT.getTime() + 60 * 60 * 1_000),
    );
    await persistCohort(
      poisoned,
      15,
      [RAW_ORIGIN, DESTINATION],
      new Date(IN_WINDOW_AT.getTime() + 2 * 60 * 60 * 1_000),
    );

    const healthy = await seedPollableWorkspace(db, { prefix: "o012f-", now: NOW });
    await persistCohort(healthy, 3, [ORIGIN, DETOUR, ORIGIN, DETOUR, ORIGIN], IN_WINDOW_AT);
    await persistCohort(healthy, 12, [ORIGIN], new Date(IN_WINDOW_AT.getTime() + 60 * 60 * 1_000));
    await persistCohort(
      healthy,
      15,
      [ORIGIN, DESTINATION],
      new Date(IN_WINDOW_AT.getTime() + 2 * 60 * 60 * 1_000),
    );

    const logger = recordingLogger();
    const source = createAnalysisLaneSource({ db, logger });
    const lanes = await source.listDueLanes(NOW);

    expect(lanes.some((lane) => lane.projectId === poisoned.projectId)).toBe(false);

    const survivor = lanes.find((lane) => lane.projectId === healthy.projectId);
    expect(survivor?.candidates.length).toBe(1);

    expect(
      logger.lines.some(
        (line) => line.includes("skipping project") && line.includes(poisoned.projectId),
      ),
    ).toBe(true);
  });

  test("a lane whose sessions all fail the gate yields candidates [] with sessions considered, and logs the rejection", async () => {
    const workspace = await seedPollableWorkspace(db, { prefix: "o012d-", now: NOW });

    await persistCohort(workspace, 12, [ORIGIN], IN_WINDOW_AT);
    await persistCohort(
      workspace,
      18,
      [ORIGIN, DESTINATION],
      new Date(IN_WINDOW_AT.getTime() + 60 * 60 * 1_000),
    );

    const logger = recordingLogger();
    const source = createAnalysisLaneSource({ db, logger });
    const lanes = await source.listDueLanes(NOW);
    const lane = lanes.find((candidate) => candidate.projectId === workspace.projectId);
    if (lane === undefined) throw new Error("expected a lane for the gated project");

    expect(lane.sessionsConsidered).toBe(30);
    expect(lane.candidates).toEqual([]);

    expect(
      logger.lines.some(
        (line) => line.includes("gate rejected") && line.includes(workspace.projectId),
      ),
    ).toBe(true);
  });

  test("a project whose sessions carry replay transcripts with a qualifying rage-click burst yields an observed_struggle candidate", async () => {
    const rules = currentRules();
    const workspace = await seedPollableWorkspace(db, { prefix: "o046a-", now: NOW });

    for (let index = 0; index < rules.struggleObservedMinSessions; index += 1) {
      await persistStrugglingSession(
        workspace,
        ORIGIN,
        rules.struggleRageClickMin,
        new Date(IN_WINDOW_AT.getTime() + index * SESSION_STRIDE_MS),
      );
    }

    const logger = recordingLogger();
    const source = createAnalysisLaneSource({ db, logger });
    const lanes = await source.listDueLanes(NOW);
    const lane = lanes.find((candidate) => candidate.projectId === workspace.projectId);
    if (lane === undefined) throw new Error("expected a lane for the struggling project");

    const struggle = lane.candidates.find(
      (candidate) => candidate.detector === "observed_struggle",
    );
    if (struggle === undefined) {
      throw new Error(
        `expected an observed_struggle candidate; got detectors [${lane.candidates.map((c) => c.detector).join(", ")}]`,
      );
    }

    expect(() => candidateFindingSchema.parse(struggle)).not.toThrow();
    expect(struggle.surface).toBe(ORIGIN);
  });

  // D5: a corpus whose sessions carry no replay data at all (no recording ever pulled) must not
  // crash the tick or produce a struggle candidate out of nothing — `corpus.replays` stays empty
  // and `observedStruggleCandidates` iterates zero replays, same as any other empty-input case.
  test("a project with sessions but no replay transcripts never yields an observed_struggle candidate", async () => {
    const workspace = await seedPollableWorkspace(db, { prefix: "o046b-", now: NOW });
    await persistCohort(workspace, 12, [ORIGIN], IN_WINDOW_AT);

    const source = createAnalysisLaneSource({ db, logger: recordingLogger() });
    const lanes = await source.listDueLanes(NOW);
    const lane = lanes.find((candidate) => candidate.projectId === workspace.projectId);
    if (lane === undefined) throw new Error("expected a lane for the replay-less project");

    expect(lane.candidates.some((candidate) => candidate.detector === "observed_struggle")).toBe(
      false,
    );
  });
});

type DivergenceServiceFor = (ctx: TenantContext) => DivergenceService;

function throwingDivergenceService(message: string): {
  readonly service: DivergenceService;
  calls: number;
} {
  const state = { calls: 0 };
  return {
    service: {
      recordDivergence: () => {
        state.calls += 1;
        return Promise.reject(new Error(message));
      },
    } as DivergenceService,
    get calls() {
      return state.calls;
    },
  };
}

// ADD Decision 5 (tasks/o-043-divergence-beat/add.md) wires divergence computation inside
// buildLane, after assembleCandidates, behind its own inner try/catch distinct from the
// outer per-project one. These tests drive the real entry points (laneForProject/
// listDueLanes) per the Wave 0 Contract Checklist's D11 rows — never a hand-built call to
// computeDivergence in isolation.
describe("createAnalysisLaneSource — divergence wiring at the real entry point (O-043, D11)", () => {
  test("laneForProject persists a divergence row for a project with a qualifying funnel_dropoff surface", async () => {
    const workspace = await seedPollableWorkspace(db, { prefix: "o043a-", now: NOW });

    await persistCohort(workspace, 3, [ORIGIN, DETOUR, ORIGIN, DETOUR, ORIGIN], IN_WINDOW_AT);
    await persistCohort(
      workspace,
      12,
      [ORIGIN],
      new Date(IN_WINDOW_AT.getTime() + 60 * 60 * 1_000),
    );
    await persistCohort(
      workspace,
      15,
      [ORIGIN, DESTINATION],
      new Date(IN_WINDOW_AT.getTime() + 2 * 60 * 60 * 1_000),
    );

    const source = createAnalysisLaneSource({ db, logger: recordingLogger() });
    const lane = await source.laneForProject(workspace.projectId, NOW);
    if (lane === null) throw new Error("expected a lane for the qualifying project");

    expect(lane.candidates.length).toBe(1);
    expect(lane.candidates[0]?.surface).toBe(ORIGIN);

    const repo = createDivergencePointsRepo(db, workspace.ownerCtx);
    const found = await repo.findBySurface(workspace.projectId, ORIGIN);

    expect(found?.organizationId).toBe(workspace.organizationId);
    expect(found?.surface).toBe(ORIGIN);
  });

  test("listDueLanes persists at most one divergence row per surface per tick", async () => {
    const workspace = await seedPollableWorkspace(db, { prefix: "o043b-", now: NOW });
    const SECOND_ORIGIN = "/signup";

    await persistCohort(workspace, 3, [ORIGIN, DETOUR, ORIGIN, DETOUR, ORIGIN], IN_WINDOW_AT);
    await persistCohort(
      workspace,
      12,
      [ORIGIN],
      new Date(IN_WINDOW_AT.getTime() + 60 * 60 * 1_000),
    );
    await persistCohort(
      workspace,
      15,
      [ORIGIN, DESTINATION],
      new Date(IN_WINDOW_AT.getTime() + 2 * 60 * 60 * 1_000),
    );

    await persistCohort(
      workspace,
      3,
      [SECOND_ORIGIN, DETOUR, SECOND_ORIGIN, DETOUR, SECOND_ORIGIN],
      IN_WINDOW_AT,
    );
    await persistCohort(
      workspace,
      12,
      [SECOND_ORIGIN],
      new Date(IN_WINDOW_AT.getTime() + 60 * 60 * 1_000),
    );
    await persistCohort(
      workspace,
      15,
      [SECOND_ORIGIN, DESTINATION],
      new Date(IN_WINDOW_AT.getTime() + 2 * 60 * 60 * 1_000),
    );

    const source = createAnalysisLaneSource({ db, logger: recordingLogger() });
    const lanes = await source.listDueLanes(NOW);
    const lane = lanes.find((candidate) => candidate.projectId === workspace.projectId);
    if (lane === undefined) throw new Error("expected a lane for the two-surface project");

    expect(lane.candidates.length).toBe(2);

    const repo = createDivergencePointsRepo(db, workspace.ownerCtx);
    const foundOrigin = await repo.findBySurface(workspace.projectId, ORIGIN);
    const foundSecondOrigin = await repo.findBySurface(workspace.projectId, SECOND_ORIGIN);

    expect(foundOrigin?.surface).toBe(ORIGIN);
    expect(foundSecondOrigin?.surface).toBe(SECOND_ORIGIN);
  });

  test("a divergence computation failure for one surface does not prevent that project's candidates from being returned", async () => {
    const workspace = await seedPollableWorkspace(db, { prefix: "o043c-", now: NOW });

    await persistCohort(workspace, 3, [ORIGIN, DETOUR, ORIGIN, DETOUR, ORIGIN], IN_WINDOW_AT);
    await persistCohort(
      workspace,
      12,
      [ORIGIN],
      new Date(IN_WINDOW_AT.getTime() + 60 * 60 * 1_000),
    );
    await persistCohort(
      workspace,
      15,
      [ORIGIN, DESTINATION],
      new Date(IN_WINDOW_AT.getTime() + 2 * 60 * 60 * 1_000),
    );

    const failure = throwingDivergenceService(`o043c: simulated divergence failure for ${ORIGIN}`);
    const logger = recordingLogger();

    const deps: AnalysisLaneSourceDeps & { readonly divergenceServiceFor: DivergenceServiceFor } = {
      db,
      logger,
      divergenceServiceFor: () => failure.service,
    };

    const source = createAnalysisLaneSource(deps);
    const lane = await source.laneForProject(workspace.projectId, NOW);
    if (lane === null) throw new Error("expected a lane despite the divergence failure");

    expect(lane.candidates.length).toBe(1);
    expect(lane.sessionsConsidered).toBe(30);

    expect(failure.calls).toBeGreaterThan(0);
    expect(
      logger.lines.some(
        (line) => line.includes("divergence") && line.includes(workspace.projectId),
      ),
    ).toBe(true);
  });

  test("re-running laneForProject for the identical window does not create a second divergence row", async () => {
    const workspace = await seedPollableWorkspace(db, { prefix: "o043d-", now: NOW });

    await persistCohort(workspace, 3, [ORIGIN, DETOUR, ORIGIN, DETOUR, ORIGIN], IN_WINDOW_AT);
    await persistCohort(
      workspace,
      12,
      [ORIGIN],
      new Date(IN_WINDOW_AT.getTime() + 60 * 60 * 1_000),
    );
    await persistCohort(
      workspace,
      15,
      [ORIGIN, DESTINATION],
      new Date(IN_WINDOW_AT.getTime() + 2 * 60 * 60 * 1_000),
    );

    const source = createAnalysisLaneSource({ db, logger: recordingLogger() });
    const repo = createDivergencePointsRepo(db, workspace.ownerCtx);

    await source.laneForProject(workspace.projectId, NOW);
    const afterFirst = await repo.findBySurface(workspace.projectId, ORIGIN);

    await source.laneForProject(workspace.projectId, NOW);
    const afterSecond = await repo.findBySurface(workspace.projectId, ORIGIN);

    // The identity conflict target (org, project, surface, cohortMatchVersion, window) is
    // identical across both calls (same NOW, same window) — a second row would only be
    // possible if the second call bypassed the upsert-on-conflict path (ADD Decision 4).
    expect(afterFirst?.id).toBeDefined();
    expect(afterSecond?.id).toBe(afterFirst?.id);
  });

  test("a project with zero funnel_dropoff-qualifying surfaces produces zero divergence rows and no error", async () => {
    const workspace = await seedPollableWorkspace(db, { prefix: "o043e-", now: NOW });

    const logger = recordingLogger();
    const source = createAnalysisLaneSource({ db, logger });
    const lane = await source.laneForProject(workspace.projectId, NOW);
    if (lane === null) throw new Error("expected a lane for the empty project");

    expect(lane.candidates).toEqual([]);

    const repo = createDivergencePointsRepo(db, workspace.ownerCtx);
    const found = await repo.findBySurface(workspace.projectId, ORIGIN);

    expect(found).toBeNull();
    expect(logger.lines.some((line) => line.includes("divergence computation failed"))).toBe(false);
  });
});
