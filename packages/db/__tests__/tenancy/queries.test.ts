// Tests for the tenancy bootstrap reads. The queries that resolve who a request is
// acting as, before any organization scope exists.
//
// The headline assertion is isolation: these functions are the one place in the
// codebase that reads membership without a `TenantContext` to scope by, so the `WHERE
// user_id = $1` predicate is the entire tenant boundary. A missing or wrong predicate
// would return every organization in the database to the first user who signs in, and
// `deriveTenantContext` would happily resolve one of them. Runs against real SQL via
// PGlite, never a fake.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  findMembershipsByUserId,
  findOrganizationBySlug,
  findUserNameById,
} from "../../src/tenancy/queries";
import { createTestDb, type TestDb } from "../../src/testing";
import { seedMember, seedOrgWithOwner, seedOrganization, seedUser } from "../helpers/fixtures";

describe("findMembershipsByUserId", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  test("returns only the calling user's memberships when another org exists", async () => {
    const orgA = await seedOrgWithOwner(db, {
      orgName: "Org A",
      userName: "Owner A",
      email: `owner-a-${crypto.randomUUID()}@example.com`,
    });
    const orgB = await seedOrgWithOwner(db, {
      orgName: "Org B",
      userName: "Owner B",
      email: `owner-b-${crypto.randomUUID()}@example.com`,
    });

    const memberships = await findMembershipsByUserId(db, orgA.userId);

    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.organizationId).toBe(orgA.organizationId);
    // The proof that the predicate is real: org B exists in the same table and must not
    // appear.
    expect(memberships.map((row) => row.organizationId)).not.toContain(orgB.organizationId);
  });

  test("populates organizationName from the joined organization row", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "Joined Name Co",
      userName: "Owner",
      email: `join-${crypto.randomUUID()}@example.com`,
    });

    const [membership] = await findMembershipsByUserId(db, org.userId);

    expect(membership?.organizationName).toBe("Joined Name Co");
    expect(membership?.role).toBe("owner");
    expect(membership?.createdAt).toBeInstanceOf(Date);
  });

  test("returns every membership, with its own role, for a user in two organizations", async () => {
    const home = await seedOrgWithOwner(db, {
      orgName: "Home Org",
      userName: "Dual Member",
      email: `dual-${crypto.randomUUID()}@example.com`,
    });
    const guest = await seedOrganization(db, { name: "Guest Org" });
    await seedMember(db, { organizationId: guest.id, userId: home.userId, role: "member" });

    const memberships = await findMembershipsByUserId(db, home.userId);

    expect(memberships).toHaveLength(2);
    // `resolveActiveOrganization` orders by createdAt and reads role off the resolved
    // membership, so both must survive the join per-row.
    const byOrgId = new Map(memberships.map((row) => [row.organizationId, row]));
    expect(byOrgId.get(home.organizationId)?.role).toBe("owner");
    expect(byOrgId.get(guest.id)?.role).toBe("member");
  });

  test("orders memberships oldest-first, matching resolveActiveOrganization's own sort", async () => {
    // `ensureOrganization` returns `[0]` of this list, and `resolveActiveOrganization`
    // independently sorts by (createdAt, organizationId). Without an order by here the
    // two can disagree, and which organization a multi-org user lands in becomes
    // whatever order Postgres happens to return rows in.
    const user = await seedUser(db, {
      name: "Ordered Member",
      email: `ordered-${crypto.randomUUID()}@example.com`,
    });

    // Every natural row order is seeded backwards relative to the expected result. The
    // newer-membership org is inserted first in `organization` and its `member` row is
    // inserted first. Both tables' physical order and either join direction therefore
    // yield [newer, older]; only the order by produces [older, newer]. Verified to fail
    // when the order by is removed.
    const newer = await seedOrganization(db, { name: "Newer Org" });
    const older = await seedOrganization(db, { name: "Older Org" });

    await seedMember(db, {
      organizationId: newer.id,
      userId: user.id,
      role: "member",
      createdAt: new Date("2026-02-01T00:00:00Z"),
    });
    await seedMember(db, {
      organizationId: older.id,
      userId: user.id,
      role: "owner",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });

    const memberships = await findMembershipsByUserId(db, user.id);

    expect(memberships.map((row) => row.organizationId)).toEqual([older.id, newer.id]);
  });

  test("returns an empty array for a user with no memberships", async () => {
    // The self-heal trigger state. An empty result is a legitimate value that callers
    // branch on, never an error.
    const orphan = await seedUser(db, {
      name: "No Org",
      email: `no-org-${crypto.randomUUID()}@example.com`,
    });

    expect(await findMembershipsByUserId(db, orphan.id)).toEqual([]);
  });

  test("returns an empty array for an unknown user id rather than throwing", async () => {
    expect(await findMembershipsByUserId(db, "user-does-not-exist")).toEqual([]);
  });
});

describe("findOrganizationBySlug", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  test("returns the organization holding an exact slug", async () => {
    const org = await seedOrganization(db, { name: "Slug Co" });

    const found = await findOrganizationBySlug(db, org.slug);

    expect(found?.id).toBe(org.id);
    expect(found?.name).toBe("Slug Co");
  });

  test("returns undefined for a near-miss slug", async () => {
    const org = await seedOrganization(db, { name: "Near Miss Co" });

    // Matching is exact, a prefix must not resolve to the org, or ensureOrganization's
    // orphan-repair branch would attach a user to someone else's workspace.
    expect(await findOrganizationBySlug(db, org.slug.slice(0, -1))).toBeUndefined();
    expect(await findOrganizationBySlug(db, `${org.slug}x`)).toBeUndefined();
  });
});

describe("findUserNameById", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  test("returns the user's name", async () => {
    const user = await seedUser(db, {
      name: "Ada Lovelace",
      email: `ada-${crypto.randomUUID()}@example.com`,
    });

    expect(await findUserNameById(db, user.id)).toBe("Ada Lovelace");
  });

  test("returns null for an unknown user id", async () => {
    expect(await findUserNameById(db, "user-does-not-exist")).toBeNull();
  });
});
