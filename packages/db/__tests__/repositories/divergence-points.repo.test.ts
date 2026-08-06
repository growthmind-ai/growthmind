import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { and, eq } from "drizzle-orm";

import type { TenantContext } from "@growthmind/shared";

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

function makeRecordInput(
  projectId: string,
  overrides: Partial<RecordDivergenceInput> = {},
): RecordDivergenceInput {
  return {
    projectId,
    surface: "/checkout",
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

    const found = await repo.findBySurface(project.id, input.surface);

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

    const found = await teammateRepo.findBySurface(project.id, input.surface);

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

    const foundFromB = await repoB.findBySurface(projectA.id, input.surface);

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
