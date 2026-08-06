import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import {
  computeDivergence,
  type AnalysisWindow,
  type DivergenceCohortInput,
  type DivergenceResult,
  type SessionTimeline,
  type TimelineEvent,
} from "@growthmind/core";

import { createDivergenceService } from "../../src/services/divergence.service";
import { createTestDb, laneNames, seedOrgWithOwner, seedProject, type TestDb } from "../../src/testing";

const NAMES = laneNames("divsvc");

const SURFACE = "/pricing";
const DESTINATION = "/checkout";

const WINDOW: AnalysisWindow = {
  start: new Date("2026-07-01T00:00:00.000Z"),
  end: new Date("2026-07-08T00:00:00.000Z"),
};

const FIRST_SESSION_STARTED_AT = new Date("2026-07-03T09:00:00.000Z");
const SESSION_STRIDE_MS = 60_000;
const EVENT_STRIDE_MS = 1_000;

// Matches DIVERGENCE_COHORT_FLOOR = 5 (ADD Decision 6) — both cohorts must clear it
// for computeDivergence to compare them rather than refuse.
const COHORT_SIZE = 5;

function sessionTimeline(
  idPrefix: string,
  index: number,
  paths: readonly string[],
): SessionTimeline {
  const startedAt = new Date(FIRST_SESSION_STARTED_AT.getTime() + index * SESSION_STRIDE_MS);
  const events: readonly TimelineEvent[] = paths.map((urlPath, offset) => ({
    sourceEventId: `${idPrefix}-${index}-e${offset}`,
    name: "step",
    occurredAt: new Date(startedAt.getTime() + offset * EVENT_STRIDE_MS),
    urlPath,
    urlPathNormalisationVersion: 1,
  }));

  return {
    sessionId: `${idPrefix}-${String(index).padStart(3, "0")}`,
    startedAt,
    exclusionReason: "none",
    entryUrlPath: paths[0] ?? null,
    events,
  };
}

function cohortOf(idPrefix: string, paths: readonly string[]): readonly SessionTimeline[] {
  return Array.from({ length: COHORT_SIZE }, (_, index) => sessionTimeline(idPrefix, index, paths));
}

describe("divergence service — real persistence (ADD §Wave 0 Contract Checklist, FR-6)", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("recordDivergence computes and persists in one call, returning both the pure result and the stored record", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("e2e"),
      userName: NAMES.userName("e2e-owner"),
      email: NAMES.email("e2e-owner"),
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("e2e"),
    });

    // succeeded sessions continue to DESTINATION; failed sessions drop at SURFACE —
    // the same succeeded/failed split funnelDropoffCohorts (ADD Decision 2) hands off.
    const succeeded = cohortOf("succeeded", [SURFACE, DESTINATION]);
    const failed = cohortOf("failed", [SURFACE]);

    const cohortInput: DivergenceCohortInput = { surface: SURFACE, succeeded, failed };

    const service = createDivergenceService(db, org.ctx);

    const recorded = await service.recordDivergence({
      projectId: project.id,
      surface: SURFACE,
      window: WINDOW,
      succeeded,
      failed,
    });

    const expected: DivergenceResult = computeDivergence(cohortInput);

    expect(recorded.result).toEqual(expected);
    expect(recorded.record).toBeTruthy();
  });
});
