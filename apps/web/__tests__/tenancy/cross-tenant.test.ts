// Wave 0 (red): the sprint's headline cross-tenant proof (add
// tasks/tenancy-app-shell/add.md, //; prd; edge-taxonomy). the definition of done
// literally names this test. "a cross-tenant access test proves org A cannot read or
// mutate org B rows", so it may never be weakened, skipped, or downgraded to fakes. It
// runs against real SQL via PGlite (`createTestDb`, wired through
// `./helpers/auth-fixture.ts`) because a fake repository proves nothing about SQL-level
// tenant scoping.
//
// fixture shape: two users in org A (owner A1, non-owner teammate A2) and one user in
// org B. Memberships are built through the real product path, `signUpTestUser`
// (auth.api.signUpEmail) and `addTestMember` (auth.api.addMember), never a raw
// `member`-row seed. `ensureOrganization` is still an unimplemented stub, so
// organizations are bootstrapped via `createTestOrganization` (fixture-only, per its
// own doc comment).
//
// Every repository factory in `@growthmind/db` is currently a typed stub whose method
// bodies throw `new Error("not implemented")` (m0 scaffold). Each test below seeds
// through the real repository surface (`.create`/`.mint`) before asserting the
// cross-tenant contract, so every test in this file fails now at that first stub call,
// always for the reason "not implemented", never a compile error, never a fixture error
// (unique-constraint violation, missing row). Once a later wave fills in the repository
// bodies, the seed calls succeed and the assertions below are what prove / for real.
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
  /** Owner of org A. Created org A, membership role "owner". */
  ownerA1Ctx: TenantContext;
  /** A second, non-owner member of org A. Added via the real Better Auth `addMember`
   * path, never a raw `member` row. */
  teammateA2Ctx: TenantContext;
  /** The sole user of org B. The "other org" every test's foreign-id probes are
   * launched from. */
  userBCtx: TenantContext;
}

/**
 * Builds the fixture shape fresh for one test: signs up three real users over the
 * shared Better Auth + PGlite instance, bootstraps two organizations
 * (`createTestOrganization`, since `ensureOrganization` is still a Wave 0 stub), adds
 * the org A teammate through `addTestMember`, and assembles a `TenantContext` for each
 * of the three (userId, org) pairs via `buildTestTenantContext`, the same construction
 * path `getTenantContext` will use in production.
 *
 * `testId` must be unique per call so every seeded email stays globally unique within
 * this file (a sibling suite lost time to `user_email_unique` violations from reused
 * emails).
 */
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

    // Never org A's data. Null/empty, not a rejection that could hide a partial leak.
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

    // 1) Projects rename.
    const projectsRepoB = createProjectsRepo(authCtx.db, fixture.userBCtx);
    const renameResult = await projectsRepoB.rename(projectA.id, "Hijacked Project Name");
    expect(renameResult).toBeNull();
    // No silent success: re-read through org A's own repo and prove the name is
    // genuinely untouched.
    const rereadProject = await projectsRepoA.findById(projectA.id);
    expect(rereadProject?.name).toBe("Original Project Name");

    // 2) Write-key revoke.
    const writeKeysRepoB = createWriteKeysRepo(authCtx.db, fixture.userBCtx);
    const revokeResult = await writeKeysRepoB.revoke(mintedA.key.id);
    expect(revokeResult).toBeNull();
    const rereadKeys = await writeKeysRepoA.listByProject(projectA.id);
    const rereadKey = rereadKeys.find((key) => key.id === mintedA.key.id);
    expect(rereadKey?.revokedAt).toBeNull();

    // 3) Organization rename: `OrganizationsRepo.rename` takes no organization-id
    //  parameter at all. It is structurally confined to the constructing context's
    //  own org. Calling it as org B can therefore only ever rename org B, never org
    //  A; we assert both halves: the call returns B's own (renamed) row, and org A's
    //  row is untouched when re-read independently.
    const organizationsRepoB = createOrganizationsRepo(authCtx.db, fixture.userBCtx);
    const orgRenameResult = await organizationsRepoB.rename("Attempted Takeover Of Org A");
    expect(orgRenameResult.id).toBe(fixture.orgB.id);
    expect(orgRenameResult.name).toBe("Attempted Takeover Of Org A");

    const rereadOrgA = await readOrganizationById(authCtx.db, fixture.orgA.id);
    expect(rereadOrgA?.name).toBe(fixture.orgA.name);
  });

  it("org A's non-owner teammate CAN read org A's projects, write-key metadata, and org name", async () => {
    const fixture = await buildCrossTenantFixture(authCtx, "fr8c");
    // Sanity on the fixture itself: A2 must genuinely be a non-owner. This test is
    // worthless if it accidentally asserts the owner cell.
    expect(fixture.teammateA2Ctx.role).not.toBe("owner");

    const projectsRepoOwner = createProjectsRepo(authCtx.db, fixture.ownerA1Ctx);
    const projectA = await projectsRepoOwner.create({ name: "Org A Checkout Funnel" });

    const writeKeysRepoOwner = createWriteKeysRepo(authCtx.db, fixture.ownerA1Ctx);
    const mintedA = await writeKeysRepoOwner.mint({ projectId: projectA.id, kind: "standard" });

    // The teammate cell asserted, not assumed. A2 must see exactly what the owner sees,
    // not a narrowed view.
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

    // findById with a foreign project id.
    expect(await projectsRepoB.findById(projectA.id)).toBeNull();

    // rename with a foreign project id.
    expect(await projectsRepoB.rename(projectA.id, "Widened Access")).toBeNull();

    // revoke with a foreign write-key id.
    expect(await writeKeysRepoB.revoke(mintedA.key.id)).toBeNull();

    // mint({ projectId }) with a foreign project id. The client-supplied id must not
    // widen B's mint into A's project; it must be rejected outright, not silently
    // minted against the wrong org.
    let mintRejected: unknown;
    try {
      await writeKeysRepoB.mint({ projectId: projectA.id, kind: "standard" });
    } catch (error) {
      mintRejected = error;
    }
    expect(mintRejected).toBeInstanceOf(Error);
  });
});
