import { randomUUID } from "node:crypto";

import { candidateFindingSchema } from "@growthmind/core";
import { createTestDb, seedEvents, seedSession, type TestDb } from "@growthmind/db/testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { ANALYSIS_WINDOW_MS, createAnalysisLaneSource } from "../src/analysis-lane-source";
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
});
