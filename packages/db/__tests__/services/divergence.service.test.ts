import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { and, eq } from "drizzle-orm";

import {
  computeDivergence,
  DIVERGENCE_COHORT_FLOOR,
  type AnalysisWindow,
  type DivergenceCohortInput,
  type DivergenceResult,
  type SessionTimeline,
  type TimelineEvent,
} from "@growthmind/core";

import { browserCut, SURFACE_COHORT_CUT } from "@growthmind/shared";

import type { RecordDivergenceInput } from "../../src/repositories/divergence-points.repo";
import * as schema from "../../src/schema";
import { createDivergenceService } from "../../src/services/divergence.service";
import {
  createTestDb,
  laneNames,
  seedOrgWithOwner,
  seedProject,
  type TestDb,
} from "../../src/testing";

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

function cohortOfSize(
  idPrefix: string,
  paths: readonly string[],
  size: number,
): readonly SessionTimeline[] {
  return Array.from({ length: size }, (_, index) => sessionTimeline(idPrefix, index, paths));
}

function cohortOf(idPrefix: string, paths: readonly string[]): readonly SessionTimeline[] {
  return cohortOfSize(idPrefix, paths, COHORT_SIZE);
}

const BROWSER_CHROME_CUT = browserCut("chrome");
const BROWSER_SAFARI_CUT = browserCut("safari");
const BROWSER_UNKNOWN_CUT = browserCut("unknown");

const SUCCEEDED_PATHS = [SURFACE, DESTINATION] as const;
const FAILED_PATHS = [SURFACE] as const;

const SURFACE_FIXTURES = [
  {
    label: "diverged",
    succeededPaths: SUCCEEDED_PATHS,
    failedPaths: FAILED_PATHS,
    size: DIVERGENCE_COHORT_FLOOR,
  },
  {
    label: "no_divergence",
    succeededPaths: SUCCEEDED_PATHS,
    failedPaths: SUCCEEDED_PATHS,
    size: DIVERGENCE_COHORT_FLOOR,
  },
  {
    label: "refused",
    succeededPaths: SUCCEEDED_PATHS,
    failedPaths: FAILED_PATHS,
    size: DIVERGENCE_COHORT_FLOOR - 1,
  },
] as const;

const CHROME_SUCCEEDED = 6;
const CHROME_FAILED = 5;
const SAFARI_SUCCEEDED = 4;
const SAFARI_FAILED = 3;

function sum(sizes: readonly number[]): number {
  return sizes.reduce((total, size) => total + size, 0);
}

function outcomeOf(
  result: DivergenceResult,
): Pick<RecordDivergenceInput, "kind" | "divergedAtRank" | "reason"> {
  if (result.kind === "diverged") {
    return { kind: "diverged", divergedAtRank: result.rank, reason: null };
  }

  return { kind: result.kind, divergedAtRank: null, reason: result.reason };
}

async function divergenceRowsFor(db: TestDb, organizationId: string, projectId: string) {
  return db
    .select()
    .from(schema.divergencePoints)
    .where(
      and(
        eq(schema.divergencePoints.organizationId, organizationId),
        eq(schema.divergencePoints.projectId, projectId),
      ),
    );
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
      cohortCut: SURFACE_COHORT_CUT,
      window: WINDOW,
      succeeded,
      failed,
    });

    const expected: DivergenceResult = computeDivergence(cohortInput);

    expect(recorded.result).toEqual(expected);
    expect(recorded.record).toBeTruthy();
  });
});

describe("divergence service — per-cut persistence (ADD FR-7/FR-8, AC-5 ii, AC-6)", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  async function scopeFor(label: string) {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName(label),
      userName: NAMES.userName(`${label}-owner`),
      email: NAMES.email(`${label}-owner`),
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName(label),
    });

    return { org, project, service: createDivergenceService(db, org.ctx) };
  }

  for (const fixture of SURFACE_FIXTURES) {
    it(`persists the surface-level row exactly as before for a ${fixture.label} cohort`, async () => {
      const { org, project, service } = await scopeFor(`surface-${fixture.label}`);

      const succeeded = cohortOfSize("succeeded", fixture.succeededPaths, fixture.size);
      const failed = cohortOfSize("failed", fixture.failedPaths, fixture.size);

      await service.recordDivergence({
        projectId: project.id,
        surface: SURFACE,
        cohortCut: SURFACE_COHORT_CUT,
        window: WINDOW,
        succeeded,
        failed,
      });

      const expected = outcomeOf(computeDivergence({ surface: SURFACE, succeeded, failed }));
      const [row] = await divergenceRowsFor(db, org.organizationId, project.id);

      expect(row?.cohortCut).toBe(SURFACE_COHORT_CUT);
      expect(row?.kind).toBe(expected.kind);
      expect(row?.divergedAtRank).toBe(expected.divergedAtRank);
      expect(row?.reason).toBe(expected.reason);
      expect(row?.succeededCohortSize).toBe(fixture.size);
      expect(row?.failedCohortSize).toBe(fixture.size);
      expect(row?.surfaceNormalisationVersion).toBe(1);
    });
  }

  it("gives every bucket row its own denominators, summing to the surface totals", async () => {
    const { org, project, service } = await scopeFor("bucket-denominators");

    const succeeded = cohortOfSize(
      "succeeded",
      SUCCEEDED_PATHS,
      CHROME_SUCCEEDED + SAFARI_SUCCEEDED,
    );
    const failed = cohortOfSize("failed", FAILED_PATHS, CHROME_FAILED + SAFARI_FAILED);

    for (const cut of [
      { cohortCut: SURFACE_COHORT_CUT, succeeded, failed },
      {
        cohortCut: BROWSER_CHROME_CUT,
        succeeded: succeeded.slice(0, CHROME_SUCCEEDED),
        failed: failed.slice(0, CHROME_FAILED),
      },
      {
        cohortCut: BROWSER_SAFARI_CUT,
        succeeded: succeeded.slice(CHROME_SUCCEEDED),
        failed: failed.slice(CHROME_FAILED),
      },
    ] as const) {
      await service.recordDivergence({
        projectId: project.id,
        surface: SURFACE,
        window: WINDOW,
        ...cut,
      });
    }

    const rows = await divergenceRowsFor(db, org.organizationId, project.id);
    const byCut = new Map(rows.map((row) => [row.cohortCut, row]));

    expect(byCut.get(BROWSER_CHROME_CUT)?.succeededCohortSize).toBe(CHROME_SUCCEEDED);
    expect(byCut.get(BROWSER_CHROME_CUT)?.failedCohortSize).toBe(CHROME_FAILED);
    expect(byCut.get(BROWSER_SAFARI_CUT)?.succeededCohortSize).toBe(SAFARI_SUCCEEDED);
    expect(byCut.get(BROWSER_SAFARI_CUT)?.failedCohortSize).toBe(SAFARI_FAILED);

    const browserRows = rows.filter((row) => row.cohortCut.startsWith("browser:"));

    expect(byCut.get(SURFACE_COHORT_CUT)?.succeededCohortSize).toBe(
      CHROME_SUCCEEDED + SAFARI_SUCCEEDED,
    );
    expect(byCut.get(SURFACE_COHORT_CUT)?.failedCohortSize).toBe(CHROME_FAILED + SAFARI_FAILED);
    expect(sum(browserRows.map((row) => row.succeededCohortSize))).toBe(
      CHROME_SUCCEEDED + SAFARI_SUCCEEDED,
    );
    expect(sum(browserRows.map((row) => row.failedCohortSize))).toBe(CHROME_FAILED + SAFARI_FAILED);
  });

  it("persists a below-floor bucket as refused rather than omitting it", async () => {
    const { org, project, service } = await scopeFor("bucket-refused");

    await service.recordDivergence({
      projectId: project.id,
      surface: SURFACE,
      cohortCut: BROWSER_UNKNOWN_CUT,
      window: WINDOW,
      succeeded: cohortOfSize("succeeded", SUCCEEDED_PATHS, DIVERGENCE_COHORT_FLOOR - 1),
      failed: cohortOfSize("failed", FAILED_PATHS, DIVERGENCE_COHORT_FLOOR - 1),
    });

    const rows = await divergenceRowsFor(db, org.organizationId, project.id);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.cohortCut).toBe(BROWSER_UNKNOWN_CUT);
    expect(rows[0]?.kind).toBe("refused");
    expect(rows[0]?.reason).toBe("cohort_below_floor");
  });

  it("applies the ratified floor per bucket at its ratified value", async () => {
    const { org, project, service } = await scopeFor("bucket-floor");

    const below = await service.recordDivergence({
      projectId: project.id,
      surface: SURFACE,
      cohortCut: BROWSER_CHROME_CUT,
      window: WINDOW,
      succeeded: cohortOfSize("succeeded", SUCCEEDED_PATHS, DIVERGENCE_COHORT_FLOOR - 1),
      failed: cohortOfSize("failed", FAILED_PATHS, DIVERGENCE_COHORT_FLOOR - 1),
    });

    const atFloor = await service.recordDivergence({
      projectId: project.id,
      surface: SURFACE,
      cohortCut: BROWSER_SAFARI_CUT,
      window: WINDOW,
      succeeded: cohortOfSize("succeeded", SUCCEEDED_PATHS, DIVERGENCE_COHORT_FLOOR),
      failed: cohortOfSize("failed", FAILED_PATHS, DIVERGENCE_COHORT_FLOOR),
    });

    expect(below.result).toEqual({ kind: "refused", reason: "cohort_below_floor" });
    expect(atFloor.result.kind).not.toBe("refused");

    const rows = await divergenceRowsFor(db, org.organizationId, project.id);
    const byCut = new Map(rows.map((row) => [row.cohortCut, row]));

    expect(rows).toHaveLength(2);
    expect(byCut.get(BROWSER_CHROME_CUT)?.kind).toBe("refused");
    expect(byCut.get(BROWSER_SAFARI_CUT)?.kind).not.toBe("refused");
  });
});
