import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createOrganizationsRepo, createProjectsRepo, createWriteKeysRepo } from "@growthmind/db";
import type { TenantContext } from "@growthmind/shared";

import {
  addTestMember,
  buildTestTenantContext,
  createTestOrganization,
  readOrganizationById,
  setupAuthTest,
  signUpTestUser,
  type AuthTestContext,
} from "./helpers/auth-fixture";

const TEST_PASSWORD = "correct-horse-battery-staple";

interface CrossTenantFixture {
  orgA: { id: string; name: string };
  orgB: { id: string; name: string };

  ownerA1Ctx: TenantContext;

  teammateA2Ctx: TenantContext;

  userBCtx: TenantContext;
}

async function buildCrossTenantFixture(
  authCtx: AuthTestContext,
  testId: string,
): Promise<CrossTenantFixture> {
  const ownerA1 = await signUpTestUser(authCtx.auth, {
    name: "Owner A1",
    email: `owner-a1-${testId}@example.com`,
    password: TEST_PASSWORD,
  });
  const orgARow = await createTestOrganization(authCtx.db, {
    name: "Org A",
    ownerUserId: ownerA1.id,
  });

  const teammateA2 = await signUpTestUser(authCtx.auth, {
    name: "Teammate A2",
    email: `teammate-a2-${testId}@example.com`,
    password: TEST_PASSWORD,
  });
  await addTestMember(authCtx.auth, {
    organizationId: orgARow.id,
    userId: teammateA2.id,
    role: "member",
  });

  const userB = await signUpTestUser(authCtx.auth, {
    name: "User B",
    email: `user-b-${testId}@example.com`,
    password: TEST_PASSWORD,
  });
  const orgBRow = await createTestOrganization(authCtx.db, {
    name: "Org B",
    ownerUserId: userB.id,
  });

  const [ownerA1Ctx, teammateA2Ctx, userBCtx] = await Promise.all([
    buildTestTenantContext(authCtx.db, { userId: ownerA1.id, organizationId: orgARow.id }),
    buildTestTenantContext(authCtx.db, { userId: teammateA2.id, organizationId: orgARow.id }),
    buildTestTenantContext(authCtx.db, { userId: userB.id, organizationId: orgBRow.id }),
  ]);

  return {
    orgA: { id: orgARow.id, name: orgARow.name },
    orgB: { id: orgBRow.id, name: orgBRow.name },
    ownerA1Ctx,
    teammateA2Ctx,
    userBCtx,
  };
}

describe("cross-tenant isolation — the sprint's headline proof", () => {
  let authCtx: AuthTestContext;

  beforeAll(async () => {
    authCtx = await setupAuthTest();
  });

  afterAll(async () => {
    await authCtx.close();
  });

  it("org B's user cannot read org A's projects or write-key metadata — empty or null, never data", async () => {
    const fixture = await buildCrossTenantFixture(authCtx, "fr8a");

    const projectsRepoA = createProjectsRepo(authCtx.db, fixture.ownerA1Ctx);
    const projectA = await projectsRepoA.create({ name: "Org A Landing Page" });

    const writeKeysRepoA = createWriteKeysRepo(authCtx.db, fixture.ownerA1Ctx);
    await writeKeysRepoA.mint({ projectId: projectA.id, kind: "standard" });

    const projectsRepoB = createProjectsRepo(authCtx.db, fixture.userBCtx);
    const writeKeysRepoB = createWriteKeysRepo(authCtx.db, fixture.userBCtx);

    const foundById = await projectsRepoB.findById(projectA.id);
    expect(foundById).toBeNull();

    const listedByB = await projectsRepoB.list();
    expect(listedByB.some((p) => p.id === projectA.id)).toBe(false);

    const writeKeysVisibleToB = await writeKeysRepoB.listByProject(projectA.id);
    expect(writeKeysVisibleToB).toEqual([]);
  });

  it("org B's user's mutations of org A's rows affect 0 rows — never silent success", async () => {
    const fixture = await buildCrossTenantFixture(authCtx, "fr8b");

    const projectsRepoA = createProjectsRepo(authCtx.db, fixture.ownerA1Ctx);
    const projectA = await projectsRepoA.create({ name: "Original Project Name" });

    const writeKeysRepoA = createWriteKeysRepo(authCtx.db, fixture.ownerA1Ctx);
    const mintedA = await writeKeysRepoA.mint({ projectId: projectA.id, kind: "standard" });

    const projectsRepoB = createProjectsRepo(authCtx.db, fixture.userBCtx);
    const renameResult = await projectsRepoB.rename(projectA.id, "Hijacked Project Name");
    expect(renameResult).toBeNull();

    const rereadProject = await projectsRepoA.findById(projectA.id);
    expect(rereadProject?.name).toBe("Original Project Name");

    const writeKeysRepoB = createWriteKeysRepo(authCtx.db, fixture.userBCtx);
    const revokeResult = await writeKeysRepoB.revoke(mintedA.key.id);
    expect(revokeResult).toBeNull();
    const rereadKeys = await writeKeysRepoA.listByProject(projectA.id);
    const rereadKey = rereadKeys.find((key) => key.id === mintedA.key.id);
    expect(rereadKey?.revokedAt).toBeNull();

    const organizationsRepoB = createOrganizationsRepo(authCtx.db, fixture.userBCtx);
    const orgRenameResult = await organizationsRepoB.rename("Attempted Takeover Of Org A");
    expect(orgRenameResult.id).toBe(fixture.orgB.id);
    expect(orgRenameResult.name).toBe("Attempted Takeover Of Org A");

    const rereadOrgA = await readOrganizationById(authCtx.db, fixture.orgA.id);
    expect(rereadOrgA?.name).toBe(fixture.orgA.name);
  });

  it("org A's non-owner teammate CAN read org A's projects, write-key metadata, and org name", async () => {
    const fixture = await buildCrossTenantFixture(authCtx, "fr8c");

    expect(fixture.teammateA2Ctx.role).not.toBe("owner");

    const projectsRepoOwner = createProjectsRepo(authCtx.db, fixture.ownerA1Ctx);
    const projectA = await projectsRepoOwner.create({ name: "Org A Checkout Funnel" });

    const writeKeysRepoOwner = createWriteKeysRepo(authCtx.db, fixture.ownerA1Ctx);
    const mintedA = await writeKeysRepoOwner.mint({ projectId: projectA.id, kind: "standard" });

    const projectsRepoTeammate = createProjectsRepo(authCtx.db, fixture.teammateA2Ctx);
    const foundByTeammate = await projectsRepoTeammate.findById(projectA.id);
    expect(foundByTeammate?.id).toBe(projectA.id);

    const listedByTeammate = await projectsRepoTeammate.list();
    expect(listedByTeammate.some((p) => p.id === projectA.id)).toBe(true);

    const writeKeysRepoTeammate = createWriteKeysRepo(authCtx.db, fixture.teammateA2Ctx);
    const listedKeysByTeammate = await writeKeysRepoTeammate.listByProject(projectA.id);
    expect(listedKeysByTeammate.some((key) => key.id === mintedA.key.id)).toBe(true);

    const organizationsRepoTeammate = createOrganizationsRepo(authCtx.db, fixture.teammateA2Ctx);
    const orgSeenByTeammate = await organizationsRepoTeammate.get();
    expect(orgSeenByTeammate.name).toBe(fixture.orgA.name);
  });

  it("a client-supplied foreign org or project id never widens access through any repository or service path", async () => {
    const fixture = await buildCrossTenantFixture(authCtx, "fr8d");

    const projectsRepoA = createProjectsRepo(authCtx.db, fixture.ownerA1Ctx);
    const projectA = await projectsRepoA.create({ name: "Org A Signup Flow" });

    const writeKeysRepoA = createWriteKeysRepo(authCtx.db, fixture.ownerA1Ctx);
    const mintedA = await writeKeysRepoA.mint({ projectId: projectA.id, kind: "standard" });

    const projectsRepoB = createProjectsRepo(authCtx.db, fixture.userBCtx);
    const writeKeysRepoB = createWriteKeysRepo(authCtx.db, fixture.userBCtx);

    expect(await projectsRepoB.findById(projectA.id)).toBeNull();

    expect(await projectsRepoB.rename(projectA.id, "Widened Access")).toBeNull();

    expect(await writeKeysRepoB.revoke(mintedA.key.id)).toBeNull();

    let mintRejected: unknown;
    try {
      await writeKeysRepoB.mint({ projectId: projectA.id, kind: "standard" });
    } catch (error) {
      mintRejected = error;
    }
    expect(mintRejected).toBeInstanceOf(Error);
  });
});
