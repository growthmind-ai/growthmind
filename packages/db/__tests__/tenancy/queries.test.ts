import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import * as schema from "../../src/schema";
import {
  findMembershipsByUserId,
  findNewestAccountProviderId,
  findOrganizationBySlug,
  findUserNameById,
} from "../../src/tenancy/queries";
import { createTestDb, type TestDb } from "../../src/testing";
import { seedMember, seedOrgWithOwner, seedOrganization, seedUser } from "../../src/testing";

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

    const byOrgId = new Map(memberships.map((row) => [row.organizationId, row]));
    expect(byOrgId.get(home.organizationId)?.role).toBe("owner");
    expect(byOrgId.get(guest.id)?.role).toBe("member");
  });

  test("orders memberships oldest-first, matching resolveActiveOrganization's own sort", async () => {
    const user = await seedUser(db, {
      name: "Ordered Member",
      email: `ordered-${crypto.randomUUID()}@example.com`,
    });

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

describe("findNewestAccountProviderId", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  const seedAccount = async (userId: string, providerId: string, createdAt: Date) => {
    await db.insert(schema.account).values({
      id: crypto.randomUUID(),
      accountId: `${providerId}-${crypto.randomUUID()}`,
      providerId,
      userId,
      createdAt,
      updatedAt: createdAt,
    });
  };

  const newUser = () =>
    seedUser(db, { name: "Ada", email: `ada-${crypto.randomUUID()}@example.com` });

  test("a user with no account row reports no provider, rather than throwing", async () => {
    const user = await newUser();

    expect(await findNewestAccountProviderId(db, user.id)).toBeNull();
  });

  test("the email-and-password path is reported as Better Auth stores it", async () => {
    const user = await newUser();
    await seedAccount(user.id, "credential", new Date("2026-01-01T00:00:00Z"));

    expect(await findNewestAccountProviderId(db, user.id)).toBe("credential");
  });

  // A user who links a second provider signs in through the one they just used, so the
  // sign-in event must name that rather than whichever account was created first.
  test("with two linked accounts the newest wins, not the first", async () => {
    const user = await newUser();
    await seedAccount(user.id, "credential", new Date("2026-01-01T00:00:00Z"));
    await seedAccount(user.id, "google", new Date("2026-02-01T00:00:00Z"));

    expect(await findNewestAccountProviderId(db, user.id)).toBe("google");
  });

  test("another user's account is never returned", async () => {
    const mine = await newUser();
    const theirs = await newUser();
    await seedAccount(theirs.id, "github", new Date("2026-03-01T00:00:00Z"));

    expect(await findNewestAccountProviderId(db, mine.id)).toBeNull();
  });
});
