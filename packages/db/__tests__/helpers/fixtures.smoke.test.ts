// Proves the shared seeding fixture (./fixtures.ts) actually works before
// other agents build repository test suites against it. Touches no
// stubbed repository code — only raw schema tables and the pure
// `makeTenantContext` helper — so unlike the repository suites, this test
// MUST pass in Wave 0.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { tenantContextSchema } from "@growthmind/shared";

import * as schema from "../../src/schema";
import { createTestDb, type TestDb } from "../../src/testing";
import { makeTenantContext, seedMember, seedOrgWithOwner, seedUser } from "./fixtures";

describe("repository test fixtures", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  test("seeds two organizations, a shared teammate user, and a second member; every row is queryable", async () => {
    const orgA = await seedOrgWithOwner(db, {
      orgName: "Org A",
      userName: "Owner A",
      email: "owner-a@example.com",
    });
    const orgB = await seedOrgWithOwner(db, {
      orgName: "Org B",
      userName: "Owner B",
      email: "owner-b@example.com",
    });

    // A single user shared across the fixture, added as a SECOND, non-owner
    // member of org A — the exact shape the §9 cross-tenant proof needs
    // (two orgs, plus a non-owner teammate in org A).
    const teammate = await seedUser(db, {
      name: "Org A Teammate",
      email: "teammate@example.com",
    });
    await seedMember(db, {
      organizationId: orgA.organizationId,
      userId: teammate.id,
      role: "member",
    });

    const organizations = await db.select().from(schema.organization);
    expect(organizations).toHaveLength(2);
    expect(organizations.map((org) => org.id).toSorted()).toEqual(
      [orgA.organizationId, orgB.organizationId].toSorted(),
    );

    const orgAMembers = await db
      .select()
      .from(schema.member)
      .where(eq(schema.member.organizationId, orgA.organizationId));
    expect(orgAMembers).toHaveLength(2);
    expect(orgAMembers.map((m) => m.role).toSorted()).toEqual(["member", "owner"]);

    const orgBMembers = await db
      .select()
      .from(schema.member)
      .where(eq(schema.member.organizationId, orgB.organizationId));
    expect(orgBMembers).toHaveLength(1);
    expect(orgBMembers[0]?.role).toBe("owner");

    const users = await db.select().from(schema.user);
    expect(users).toHaveLength(3);
  });

  test("makeTenantContext output parses via tenantContextSchema", async () => {
    const orgA = await seedOrgWithOwner(db, {
      orgName: "Org C",
      userName: "Owner C",
      email: "owner-c@example.com",
    });

    // The owner context returned by seedOrgWithOwner is itself built via
    // makeTenantContext — assert it round-trips through the real schema
    // rather than trusting the fixture's own construction.
    expect(tenantContextSchema.parse(orgA.ctx)).toEqual(orgA.ctx);

    const explicit = makeTenantContext({
      userId: orgA.userId,
      organizationId: orgA.organizationId,
      organizationName: orgA.organizationName,
      role: "member",
    });
    expect(tenantContextSchema.parse(explicit)).toEqual(explicit);
    expect(explicit.role).toBe("member");
  });
});
