// D11 wires for ADD §4.3: analysis_failing is emitted from the WRITE that records a
// terminal failure — both close() and reclaimAbandonedRun — never from open()'s control
// flow, and a failing health read can never turn a close into a throw. RED in Wave 0:
// neither producer emits yet.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { and, eq, ne } from "drizzle-orm";

import type { AnalysisRunStatus } from "@growthmind/shared";

import {
  ANALYSIS_RUN_LEASE_MS,
  createAnalysisRunsRepo,
  type AnalysisRunsRepo,
  type CloseRunInput,
} from "../../src/repositories/analysis-runs.repo";
import { analysisRuns } from "../../src/schema/analysis-runs";
import { notifications } from "../../src/schema/notifications";
import {
  createTestDb,
  laneNames,
  seedOrgWithOwner,
  seedProject,
  type SeededOrgWithOwner,
  type TestDb,
} from "../../src/testing";
import { failTableReads } from "../helpers/fail-table-reads";

const NAMES = laneNames("wire-analysis-failing");

const BASE = new Date("2026-08-01T09:00:00.000Z");

let db: TestDb;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

interface Lane {
  readonly org: SeededOrgWithOwner;
  readonly projectId: string;
  readonly repo: AnalysisRunsRepo;
}

async function seedLane(label: string): Promise<Lane> {
  const org = await seedOrgWithOwner(db, {
    orgName: NAMES.orgName(label),
    userName: NAMES.userName(label),
    email: NAMES.email(label),
  });
  const project = await seedProject(db, {
    organizationId: org.organizationId,
    name: NAMES.projectName(label),
  });

  return { org, projectId: project.id, repo: createAnalysisRunsRepo(db, org.ctx) };
}

function minutesAfterBase(minutes: number): Date {
  return new Date(BASE.getTime() + minutes * 60_000);
}

function closeInputFor(
  runId: string,
  projectId: string,
  status: Extract<AnalysisRunStatus, "completed" | "failed">,
  finishedAt: Date,
): CloseRunInput {
  return {
    runId,
    projectId,
    status,
    outcome: "no_candidates_passed_gate",
    stopReason: status === "failed" ? "fatal_error" : "ran_to_completion",
    finishedAt,
    modelCallsAttempted: 0,
    candidatesUnrenderable: 0,
    candidatesRefused: 0,
    resolvedModelId: null,
    tokensIn: null,
    tokensOut: null,
    failureReason: status === "failed" ? "the analysis run could not finish" : null,
  };
}

// One terminal run through the real seam: the open, then the close that is the emitter.
async function runOnce(
  lane: Lane,
  status: Extract<AnalysisRunStatus, "completed" | "failed">,
  minute: number,
): Promise<void> {
  const { run } = await lane.repo.open({
    projectId: lane.projectId,
    tickAt: minutesAfterBase(minute),
  });
  await lane.repo.close(
    closeInputFor(run.id, lane.projectId, status, minutesAfterBase(minute + 4)),
  );
}

async function analysisFailingRows(organizationId: string) {
  return db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.organizationId, organizationId),
        eq(notifications.type, "analysis_failing"),
      ),
    );
}

async function terminalRunCount(projectId: string): Promise<number> {
  const rows = await db
    .select({ id: analysisRuns.id })
    .from(analysisRuns)
    .where(and(eq(analysisRuns.projectId, projectId), ne(analysisRuns.status, "running")));
  return rows.length;
}

test("analysis_failing fires from close() when the last three runs all failed", async () => {
  const lane = await seedLane("three-closes");

  await runOnce(lane, "failed", 0);
  await runOnce(lane, "failed", 10);
  expect(await analysisFailingRows(lane.org.organizationId)).toHaveLength(0);

  await runOnce(lane, "failed", 20);

  const rows = await analysisFailingRows(lane.org.organizationId);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.subjectKind).toBe("project");
  expect(rows[0]?.subjectId).toBe(lane.projectId);
  expect(rows[0]?.audience).toBe("org");

  // A fourth failure inside the six-hour window says nothing new — the cooldown is
  // exercised through the real seam, not through emit alone.
  await runOnce(lane, "failed", 30);
  expect(await analysisFailingRows(lane.org.organizationId)).toHaveLength(1);
});

test("analysis_failing fires from reclaimAbandonedRun, not only from close()", async () => {
  const lane = await seedLane("reclaim");

  await runOnce(lane, "failed", 0);
  await runOnce(lane, "failed", 10);

  // The third failure is never close()'s: the run is abandoned, and the next open()
  // reclaims it past the lease. A detector wired only to close() is blind here.
  await lane.repo.open({ projectId: lane.projectId, tickAt: minutesAfterBase(20) });

  const pastLease = new Date(minutesAfterBase(20).getTime() + ANALYSIS_RUN_LEASE_MS + 60_000);
  const reopened = await lane.repo.open({ projectId: lane.projectId, tickAt: pastLease });
  expect(reopened.opened).toBe(true);

  const rows = await analysisFailingRows(lane.org.organizationId);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.subjectId).toBe(lane.projectId);
});

test("one failed run below the threshold emits nothing, and a completed run between two failures resets it", async () => {
  const single = await seedLane("below-threshold");
  await runOnce(single, "completed", 0);
  await runOnce(single, "completed", 10);
  await runOnce(single, "failed", 20);

  expect(await terminalRunCount(single.projectId)).toBe(3);
  expect(await analysisFailingRows(single.org.organizationId)).toHaveLength(0);

  const interrupted = await seedLane("reset-between");
  await runOnce(interrupted, "failed", 0);
  await runOnce(interrupted, "completed", 10);
  await runOnce(interrupted, "failed", 20);

  expect(await terminalRunCount(interrupted.projectId)).toBe(3);
  expect(await analysisFailingRows(interrupted.org.organizationId)).toHaveLength(0);
});

test("a failing analysis-health read cannot turn a close into a throw", async () => {
  const lane = await seedLane("health-read-outage");

  await runOnce(lane, "failed", 0);
  await runOnce(lane, "failed", 10);

  // Two failures already stand, so the blinded read below is exactly the one that would
  // have decided the emit — the isolation is exercised where it matters (FR-9 req 4, D8).
  const { run } = await lane.repo.open({ projectId: lane.projectId, tickAt: minutesAfterBase(20) });

  const blinded = createAnalysisRunsRepo(
    failTableReads(db, analysisRuns, new Error("health read outage")),
    lane.org.ctx,
  );
  const closed = await blinded.close(
    closeInputFor(run.id, lane.projectId, "failed", minutesAfterBase(24)),
  );
  expect(closed.status).toBe("failed");

  const [stored] = await db
    .select({ status: analysisRuns.status })
    .from(analysisRuns)
    .where(eq(analysisRuns.id, run.id));
  expect(stored?.status).toBe("failed");
});
