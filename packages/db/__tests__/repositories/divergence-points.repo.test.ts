import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { and, eq, sql } from "drizzle-orm";

import { browserCut, deviceCut, SURFACE_COHORT_CUT, type TenantContext } from "@growthmind/shared";

import {
  createDivergencePointsRepo,
  type RecordDivergenceInput,
} from "../../src/repositories/divergence-points.repo";
import * as schema from "../../src/schema";
import {
  createTestDb,
  makeTenantContext,
  seedMember,
  seedOrgWithOwner,
  seedProject,
  seedUser,
  type TestDb,
} from "../../src/testing";

const WINDOW_START = new Date("2026-07-24T00:00:00.000Z");
const WINDOW_END = new Date("2026-07-31T00:00:00.000Z");

const BROWSER_CHROME_CUT = browserCut("chrome");
const BROWSER_SAFARI_CUT = browserCut("safari");
const BROWSER_UNKNOWN_CUT = browserCut("unknown");
const DEVICE_DESKTOP_CUT = deviceCut("desktop");
const DEVICE_MOBILE_CUT = deviceCut("mobile");
const DEVICE_TABLET_CUT = deviceCut("tablet");

const ONE_FAN_OUT = [
  SURFACE_COHORT_CUT,
  BROWSER_CHROME_CUT,
  BROWSER_UNKNOWN_CUT,
  DEVICE_DESKTOP_CUT,
  DEVICE_MOBILE_CUT,
] as const;

function makeRecordInput(
  projectId: string,
  overrides: Partial<RecordDivergenceInput> = {},
): RecordDivergenceInput {
  return {
    projectId,
    surface: "/checkout",
    cohortCut: SURFACE_COHORT_CUT,
    surfaceNormalisationVersion: 2,
    spineVersion: 1,
    cohortMatchVersion: 1,
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    kind: "diverged",
    divergedAtRank: 3,
    reason: null,
    succeededCohortSize: 12,
    failedCohortSize: 8,
    succeededSessionIdsSample: ["session-1", "session-2"],
    failedSessionIdsSample: ["session-3", "session-4"],
    ...overrides,
  };
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

describe("divergence points repository", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("persists a diverged row scoped to the organization and project that computed it", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-divergence-persist",
      userName: "Owner Divergence Persist",
      email: "owner-divergence-persist@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "checkout-divergence-persist",
    });
    const repo = createDivergencePointsRepo(db, org.ctx);
    const input = makeRecordInput(project.id);

    await repo.recordDivergence(input);

    const found = await repo.findSurfaceCut(project.id, input.surface);

    expect(found?.organizationId).toBe(org.organizationId);
    expect(found?.projectId).toBe(project.id);
    expect(found?.surface).toBe(input.surface);
    expect(found?.kind).toBe("diverged");
    expect(found?.divergedAtRank).toBe(3);
  });

  it("a teammate in the same org can read a divergence row created by a different actor", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-divergence-teammate",
      userName: "Owner Divergence Teammate",
      email: "owner-divergence-teammate@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "checkout-divergence-teammate",
    });
    const teammate = await seedUser(db, {
      name: "Teammate Divergence",
      email: "teammate-divergence@acme.example",
    });
    await seedMember(db, {
      organizationId: org.organizationId,
      userId: teammate.id,
      role: "member",
    });
    const teammateCtx: TenantContext = makeTenantContext({
      userId: teammate.id,
      organizationId: org.organizationId,
      organizationName: org.organizationName,
      role: "member",
    });

    const ownerRepo = createDivergencePointsRepo(db, org.ctx);
    const teammateRepo = createDivergencePointsRepo(db, teammateCtx);
    const input = makeRecordInput(project.id);

    await ownerRepo.recordDivergence(input);

    const found = await teammateRepo.findSurfaceCut(project.id, input.surface);

    expect(found?.projectId).toBe(project.id);
    expect(found?.surface).toBe(input.surface);
    expect(found?.kind).toBe("diverged");
  });

  it("an actor in a different organization cannot read another org's divergence row", async () => {
    const orgA = await seedOrgWithOwner(db, {
      orgName: "acme-divergence-org-a",
      userName: "Owner Divergence Org A",
      email: "owner-divergence-org-a@acme.example",
    });
    const orgB = await seedOrgWithOwner(db, {
      orgName: "acme-divergence-org-b",
      userName: "Owner Divergence Org B",
      email: "owner-divergence-org-b@acme.example",
    });
    const projectA = await seedProject(db, {
      organizationId: orgA.organizationId,
      name: "checkout-divergence-org-a",
    });

    const repoA = createDivergencePointsRepo(db, orgA.ctx);
    const repoB = createDivergencePointsRepo(db, orgB.ctx);
    const input = makeRecordInput(projectA.id);

    await repoA.recordDivergence(input);

    const foundFromB = await repoB.findSurfaceCut(projectA.id, input.surface);

    expect(foundFromB).toBeNull();
  });

  it("every public method on DivergencePointsRepo takes ctx: TenantContext, none accepts a raw organizationId", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-divergence-scope-shape",
      userName: "Owner Divergence Scope Shape",
      email: "owner-divergence-scope-shape@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "checkout-divergence-scope-shape",
    });
    const repo = createDivergencePointsRepo(db, org.ctx);

    // RecordDivergenceInput carries no organizationId field — OrgInsertValues<T> in
    // crud.ts is `Omit<PgInsertValue<T>, "organizationId">`, so a caller cannot supply
    // one even by accident. The assertion below proves the stamped row's organizationId
    // comes from the ctx closed over at createDivergencePointsRepo, never from the input.
    const input = makeRecordInput(project.id);
    expect("organizationId" in input).toBe(false);

    const record = await repo.recordDivergence(input);

    expect(record.organizationId).toBe(org.organizationId);
  });

  it("recording the identical (org, project, surface, cohortMatchVersion, window) twice produces one row with identical content", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-divergence-idempotent",
      userName: "Owner Divergence Idempotent",
      email: "owner-divergence-idempotent@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "checkout-divergence-idempotent",
    });
    const repo = createDivergencePointsRepo(db, org.ctx);
    const input = makeRecordInput(project.id);

    const first = await repo.recordDivergence(input);
    const second = await repo.recordDivergence(input);

    expect(second.id).toBe(first.id);
    expect(second.kind).toBe(first.kind);
    expect(second.reason).toBe(first.reason);
    expect(second.divergedAtRank).toBe(first.divergedAtRank);

    const rows = await divergenceRowsFor(db, org.organizationId, project.id);
    expect(rows).toHaveLength(1);
  });

  it("two concurrent writers for the same identity converge on one row with no lost update", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-divergence-concurrent",
      userName: "Owner Divergence Concurrent",
      email: "owner-divergence-concurrent@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "checkout-divergence-concurrent",
    });
    const repo = createDivergencePointsRepo(db, org.ctx);
    const input = makeRecordInput(project.id, { surface: "/pricing" });

    await Promise.all([repo.recordDivergence(input), repo.recordDivergence(input)]);

    const rows = await divergenceRowsFor(db, org.organizationId, project.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("diverged");
    expect(rows[0]?.divergedAtRank).toBe(3);
  });

  it("a surface rename produces two independent divergence rows with no ancestry link", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-divergence-rename",
      userName: "Owner Divergence Rename",
      email: "owner-divergence-rename@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "checkout-divergence-rename",
    });
    const repo = createDivergencePointsRepo(db, org.ctx);

    await repo.recordDivergence(makeRecordInput(project.id, { surface: "/checkout" }));
    await repo.recordDivergence(makeRecordInput(project.id, { surface: "/checkout-v2" }));

    const rows = await divergenceRowsFor(db, org.organizationId, project.id);

    expect(rows).toHaveLength(2);
    const surfaces = rows.map((row) => row.surface).toSorted();
    expect(surfaces).toEqual(["/checkout", "/checkout-v2"]);

    // No ancestry table/column links these rows — the accepted B-031 gap, demonstrated
    // at this call site per .ai/decisions/0017-divergence-identity.md (ADD Decision 4).
    expect(rows[0]?.id).not.toBe(rows[1]?.id);
  });
});

async function scopeFor(db: TestDb, label: string) {
  const org = await seedOrgWithOwner(db, {
    orgName: `acme-divergence-${label}`,
    userName: `Owner Divergence ${label}`,
    email: `owner-divergence-${label}@acme.example`,
  });
  const project = await seedProject(db, {
    organizationId: org.organizationId,
    name: `checkout-divergence-${label}`,
  });

  return { org, project, repo: createDivergencePointsRepo(db, org.ctx) };
}

describe("divergence points repository — the cohort cut (ADD Decisions 5 and 6)", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("persists two cuts on one identity as two rows", async () => {
    const { org, project, repo } = await scopeFor(db, "two-cuts");

    await repo.recordDivergence(makeRecordInput(project.id, { cohortCut: SURFACE_COHORT_CUT }));
    await repo.recordDivergence(makeRecordInput(project.id, { cohortCut: BROWSER_CHROME_CUT }));

    const rows = await divergenceRowsFor(db, org.organizationId, project.id);

    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.cohortCut))).toEqual(
      new Set([SURFACE_COHORT_CUT, BROWSER_CHROME_CUT]),
    );
  });

  it("updates rather than duplicates when the same cut is written twice", async () => {
    const { org, project, repo } = await scopeFor(db, "same-cut-twice");

    await repo.recordDivergence(
      makeRecordInput(project.id, {
        cohortCut: BROWSER_UNKNOWN_CUT,
        kind: "diverged",
        divergedAtRank: 3,
        reason: null,
      }),
    );
    await repo.recordDivergence(
      makeRecordInput(project.id, {
        cohortCut: BROWSER_UNKNOWN_CUT,
        kind: "refused",
        divergedAtRank: null,
        reason: "cohort_below_floor",
      }),
    );

    const rows = await divergenceRowsFor(db, org.organizationId, project.id);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.cohortCut).toBe(BROWSER_UNKNOWN_CUT);
    expect(rows[0]?.kind).toBe("refused");
    expect(rows[0]?.reason).toBe("cohort_below_floor");
  });

  it("keeps the row count stable across two full fan-outs over the same window", async () => {
    const { org, project, repo } = await scopeFor(db, "fan-out-twice");

    for (const cohortCut of ONE_FAN_OUT) {
      await repo.recordDivergence(makeRecordInput(project.id, { cohortCut }));
    }
    expect(await divergenceRowsFor(db, org.organizationId, project.id)).toHaveLength(
      ONE_FAN_OUT.length,
    );

    for (const cohortCut of ONE_FAN_OUT) {
      await repo.recordDivergence(makeRecordInput(project.id, { cohortCut }));
    }
    expect(await divergenceRowsFor(db, org.organizationId, project.id)).toHaveLength(
      ONE_FAN_OUT.length,
    );
  });

  it("returns the record for the cut that was written, not a sibling bucket's", async () => {
    const { project, repo } = await scopeFor(db, "returned-record");

    const safari = await repo.recordDivergence(
      makeRecordInput(project.id, { cohortCut: BROWSER_SAFARI_CUT }),
    );
    const tablet = await repo.recordDivergence(
      makeRecordInput(project.id, { cohortCut: DEVICE_TABLET_CUT }),
    );

    expect(safari.cohortCut).toBe(BROWSER_SAFARI_CUT);
    expect(tablet.cohortCut).toBe(DEVICE_TABLET_CUT);
  });

  it("returns the surface-level row when later-created bucket rows exist", async () => {
    const { project, repo } = await scopeFor(db, "surface-cut-wins");

    const surfaceInput = makeRecordInput(project.id, {
      cohortCut: SURFACE_COHORT_CUT,
      kind: "diverged",
      divergedAtRank: 3,
      reason: null,
      succeededCohortSize: 12,
      failedCohortSize: 8,
    });
    await repo.recordDivergence(surfaceInput);

    // The defect this guards is a sort, so the surface row must be older than the buckets,
    // which is its shape on any project that already has divergence history.
    await db.execute(
      sql`update divergence_points set created_at = now() - interval '1 hour' where project_id = ${project.id}`,
    );

    await repo.recordDivergence(
      makeRecordInput(project.id, {
        cohortCut: BROWSER_UNKNOWN_CUT,
        kind: "refused",
        divergedAtRank: null,
        reason: "cohort_below_floor",
        succeededCohortSize: 2,
        failedCohortSize: 3,
      }),
    );
    await repo.recordDivergence(
      makeRecordInput(project.id, {
        cohortCut: DEVICE_MOBILE_CUT,
        kind: "diverged",
        divergedAtRank: 1,
        reason: null,
        succeededCohortSize: 6,
        failedCohortSize: 5,
      }),
    );

    const found = await repo.findSurfaceCut(project.id, surfaceInput.surface);

    expect(found?.cohortCut).toBe(SURFACE_COHORT_CUT);
    expect(found?.kind).toBe("diverged");
    expect(found?.divergedAtRank).toBe(3);
    expect(found?.succeededCohortSize).toBe(12);
    expect(found?.failedCohortSize).toBe(8);
  });

  it("does not return another organization's bucket rows", async () => {
    const { org: orgA, project: projectA, repo: repoA } = await scopeFor(db, "cut-org-a");
    const orgB = await seedOrgWithOwner(db, {
      orgName: "acme-divergence-cut-org-b",
      userName: "Owner Divergence Cut Org B",
      email: "owner-divergence-cut-org-b@acme.example",
    });
    const repoB = createDivergencePointsRepo(db, orgB.ctx);

    const input = makeRecordInput(projectA.id, { cohortCut: SURFACE_COHORT_CUT });
    await repoA.recordDivergence(input);
    await repoA.recordDivergence(makeRecordInput(projectA.id, { cohortCut: BROWSER_UNKNOWN_CUT }));

    expect(await repoB.findSurfaceCut(projectA.id, input.surface)).toBeNull();
    expect(await divergenceRowsFor(db, orgB.organizationId, projectA.id)).toHaveLength(0);
    expect(await divergenceRowsFor(db, orgA.organizationId, projectA.id)).toHaveLength(2);
  });

  it("serves a teammate the same surface-level row as the owner when bucket rows exist", async () => {
    const { org, project, repo } = await scopeFor(db, "cut-teammate");
    const teammate = await seedUser(db, {
      name: "Teammate Divergence Cut",
      email: "teammate-divergence-cut@acme.example",
    });
    await seedMember(db, {
      organizationId: org.organizationId,
      userId: teammate.id,
      role: "member",
    });
    const teammateCtx: TenantContext = makeTenantContext({
      userId: teammate.id,
      organizationId: org.organizationId,
      organizationName: org.organizationName,
      role: "member",
    });

    const input = makeRecordInput(project.id, {
      cohortCut: SURFACE_COHORT_CUT,
      divergedAtRank: 3,
    });
    await repo.recordDivergence(input);
    await repo.recordDivergence(
      makeRecordInput(project.id, { cohortCut: DEVICE_MOBILE_CUT, divergedAtRank: 1 }),
    );

    const found = await createDivergencePointsRepo(db, teammateCtx).findSurfaceCut(
      project.id,
      input.surface,
    );

    expect(found?.cohortCut).toBe(SURFACE_COHORT_CUT);
    expect(found?.divergedAtRank).toBe(3);
  });

  it("rejects a cohort cut outside the enumerated set at compile time", () => {
    // @ts-expect-error a label outside COHORT_CUTS is not assignable (ADD Decision 1, D9)
    const rejected: RecordDivergenceInput["cohortCut"] = "browser:netscape";

    expect<string>(rejected).toBe("browser:netscape");
  });
});
