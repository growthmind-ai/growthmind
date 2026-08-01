// the end-to-end proof: Persisted events through to a `CandidateFinding`. The first
// test in this repository that drives the whole producing pipeline against a real
// database. Rows go into `sessions` and `events` through the schema barrel against a
// real `createTestDb` PGlite instance; the real corpus service reads them, the real
// detectors propose, the real gate concludes, and the assertion at the end is on the
// lane the real producer hands the tick's port.
//
// House rules: fixture time is frozen constants (no `Date.now`); the producer
// receives `now` as a parameter, which is the property that makes the replay assertion
// at the bottom meaningful at all.
import { randomUUID } from "node:crypto";

import { candidateFindingSchema } from "@growthmind/core";
import { schema } from "@growthmind/db";
import { createTestDb, type TestDb } from "@growthmind/db/testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { ANALYSIS_WINDOW_MS, createAnalysisLaneSource } from "../src/analysis-lane-source";
import type { AnalysisLogger } from "../src/tasks/analysis-tick";
import { seedPollableWorkspace, type SeededWorkspace } from "./helpers/wire-fixtures";

// Frozen fixture time

/** The tick instant handed to `listDueLanes`. Every window derives from it. */
const NOW = new Date("2026-07-08T00:00:00.000Z");
/** Inside the trailing window. */
const IN_WINDOW_AT = new Date("2026-07-03T09:00:00.000Z");
/** One hour before the window opens. Must never reach a corpus. */
const BEFORE_WINDOW_AT = new Date(NOW.getTime() - ANALYSIS_WINDOW_MS - 60 * 60 * 1_000);

const ORIGIN = "/pricing";
const DESTINATION = "/checkout";
const DETOUR = "/faq";
const NORMALISATION_VERSION = 1;

const SESSION_STRIDE_MS = 60_000;
const EVENT_STRIDE_MS = 1_000;

// Harness

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

/** Persists one kept session walking `paths`, one event per step, the same row shapes
 * `persistPullResult` writes, seeded directly so this file tests the producing read,
 * not the poll. */
async function persistPathSession(
  workspace: SeededWorkspace,
  paths: readonly string[],
  startedAt: Date,
): Promise<void> {
  const sessionId = randomUUID();
  await db.insert(schema.sessions).values({
    id: sessionId,
    organizationId: workspace.organizationId,
    projectId: workspace.projectId,
    connectionId: workspace.connectionId,
    sessionKey: `ph:o012-${sessionId}`,
    identityKey: null,
    identityEmailDomain: null,
    identityResolution: "unresolved",
    userAgent: null,
    entryUrlPath: paths[0] ?? null,
    startedAt,
    lastEventAt: new Date(startedAt.getTime() + (paths.length - 1) * EVENT_STRIDE_MS),
    origin: "real",
    exclusionReason: "none",
    internalDomainAtStamp: null,
    exclusionRuleSetVersion: 1,
    groupingVersion: 1,
  });

  await db.insert(schema.events).values(
    paths.map((urlPath, index) => ({
      id: randomUUID(),
      organizationId: workspace.organizationId,
      projectId: workspace.projectId,
      connectionId: workspace.connectionId,
      sessionId,
      sourceEventId: `o012-${sessionId}-e${String(index).padStart(3, "0")}`,
      name: `step_${String(index)}`,
      occurredAt: new Date(startedAt.getTime() + index * EVENT_STRIDE_MS),
      urlPath,
      urlPathNormalisationVersion: NORMALISATION_VERSION,
    })),
  );
}

/** `count` sessions each walking `paths`, strided so no instants collide. */
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

    // The funnel shape the assembler suite proved pure, persisted for real: 3
    // strugglers who leave and return three times (and continue), 12 who drop at the
    // origin, 15 who convert, 30 kept in-window sessions, a 40% drop at the inclusive
    // boundary, both struggle magnitudes at their minimums.
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
    // One session before the window: if the window derivation ever drifts,
    // `sessionsConsidered` moves off 30 and this test names the defect.
    await persistPathSession(workspace, [ORIGIN], BEFORE_WINDOW_AT);

    const logger = recordingLogger();
    const source = createAnalysisLaneSource({ db, logger });

    const lanes = await source.listDueLanes(NOW);
    const lane = lanes.find((candidate) => candidate.projectId === workspace.projectId);
    if (lane === undefined) throw new Error("expected a lane for the seeded project");

    // The lane's tenant scope comes from the seeded rows themselves.
    expect(lane.organizationId).toBe(workspace.organizationId);
    expect(lane.organizationName).toBe(workspace.organizationName);
    // The corpus's own denominator: 30 kept in-window sessions. The before-window
    // session never reached the read.
    expect(lane.sessionsConsidered).toBe(30);

    // The packet's DoD line: a real `CandidateFinding`, from persisted rows.
    expect(lane.candidates.length).toBe(1);
    const finding = lane.candidates[0];
    if (finding === undefined) throw new Error("asserted one candidate above");

    // Re-parse through the contract: what the producer yields is exactly what every
    // downstream consumer compiles against, brand and refinements included.
    expect(() => candidateFindingSchema.parse(finding)).not.toThrow();
    expect(finding.detector).toBe("funnel_dropoff");
    expect(finding.finalClass).toBe("confusing");
    expect(finding.surface).toBe(ORIGIN);
    expect(finding.ranking.confidenceBasis).toBe("at_threshold");
    // The count carries the corpus's denominator, the same 30 the lane states, so a
    // rendered "12 of 30" can never disagree with the lane.
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

    // `no_sessions_to_analyse`, distinguishable by data from
    // `no_candidates_passed_gate`: zero considered, zero candidates.
    expect(lane.sessionsConsidered).toBe(0);
    expect(lane.candidates).toEqual([]);
  });

  test("one project's contract violation is contained: the sibling's lane survives and the skip is logged", async () => {
    // An un-normalised surface (uppercase) persisted as if a legacy or corrupted row.
    // The funnel fires and the gate passes, and then `evidenceShape` refuses the
    // surface before it can enter an identity (its /PII rule). That throw is a contract
    // violation inside one project's assembly, and it must cost exactly that project
    // this tick.
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

    // The poisoned project is skipped. No lane, never a crash of the tick.
    expect(lanes.some((lane) => lane.projectId === poisoned.projectId)).toBe(false);
    // Its sibling is untouched: the fleet survives one project's fault.
    const survivor = lanes.find((lane) => lane.projectId === healthy.projectId);
    expect(survivor?.candidates.length).toBe(1);
    // The skip is on the record with the project named, so the absence is debuggable
    // rather than silent.
    expect(
      logger.lines.some(
        (line) => line.includes("skipping project") && line.includes(poisoned.projectId),
      ),
    ).toBe(true);
  });

  test("a lane whose sessions all fail the gate yields candidates [] with sessions considered, and logs the rejection", async () => {
    const workspace = await seedPollableWorkspace(db, { prefix: "o012d-", now: NOW });
    // The rate fires the detector (12 of 30 at the boundary) but nobody struggled, so
    // `confusing`'s only proof is absent and the gate drops the proposal (never
    // downgraded to the class that blames the user).
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

    // `no_candidates_passed_gate`: sessions were considered, nothing survived.
    expect(lane.sessionsConsidered).toBe(30);
    expect(lane.candidates).toEqual([]);
    // The gate's refusal is on the record, never a silent vanish.
    expect(
      logger.lines.some(
        (line) => line.includes("gate rejected") && line.includes(workspace.projectId),
      ),
    ).toBe(true);
  });
});
