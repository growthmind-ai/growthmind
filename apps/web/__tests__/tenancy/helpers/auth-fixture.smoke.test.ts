// Smoke test proving apps/web/__tests__/tenancy/helpers/auth-fixture.ts works
// end to end: sign up an owner, create their organization, add a second user
// as a member via Better Auth's real `addMember` API (FR-9's real product
// path), and assert both memberships are readable back from the db.
//
// `ensureOrganization` (D-C) is still an unimplemented Wave 0 stub, so this
// test creates the organization explicitly via `createTestOrganization`
// rather than depending on it — org auto-creation itself is proven later by
// `signup-org.test.ts` against the real hook, once it exists.
//
// This test MUST pass — it proves the shared fixture, not a production
// contract.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  addTestMember,
  buildTestTenantContext,
  createTestOrganization,
  readMembershipsForUser,
  setupAuthTest,
  signUpTestUser,
  type AuthTestContext,
} from "./auth-fixture";

describe("auth-fixture helper works end to end over a real Better Auth + PGlite instance", () => {
  let ctx: AuthTestContext;

  beforeAll(async () => {
    ctx = await setupAuthTest();
  });

  afterAll(async () => {
    await ctx.close();
  });

  test("signs up an owner, creates an org, adds a teammate via addMember, and both memberships read back", async () => {
    const owner = await signUpTestUser(ctx.auth, {
      name: "Ada Lovelace",
      email: `ada-${Date.now()}@example.com`,
      password: "correct-horse-battery",
    });

    const org = await createTestOrganization(ctx.db, {
      name: "Ada's workspace",
      ownerUserId: owner.id,
    });

    const teammate = await signUpTestUser(ctx.auth, {
      name: "Grace Hopper",
      email: `grace-${Date.now()}@example.com`,
      password: "correct-horse-battery",
    });

    const addedMember = await addTestMember(ctx.auth, {
      organizationId: org.id,
      userId: teammate.id,
      role: "member",
    });
    expect(addedMember?.organizationId).toBe(org.id);
    expect(addedMember?.userId).toBe(teammate.id);

    const ownerMemberships = await readMembershipsForUser(ctx.db, owner.id);
    expect(ownerMemberships).toHaveLength(1);
    expect(ownerMemberships[0]?.organizationId).toBe(org.id);
    expect(ownerMemberships[0]?.role).toBe("owner");

    const teammateMemberships = await readMembershipsForUser(ctx.db, teammate.id);
    expect(teammateMemberships).toHaveLength(1);
    expect(teammateMemberships[0]?.organizationId).toBe(org.id);
    expect(teammateMemberships[0]?.role).toBe("member");

    const ownerContext = await buildTestTenantContext(ctx.db, {
      userId: owner.id,
      organizationId: org.id,
    });
    expect(ownerContext.organizationId).toBe(org.id);
    expect(ownerContext.organizationName).toBe("Ada's workspace");
    expect(ownerContext.role).toBe("owner");
  });
});
