import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";

import {
  resolveOrganizationForCli,
  type AdminOrganization,
  type ResolveOrganizationResult,
} from "../../src/admin";
import * as schema from "../../src/schema";
import { createTestDb, type TestDb } from "../../src/testing";
import { laneNames } from "../../src/testing";
import { seedMember, seedOrganization, seedOrgWithOwner, seedUser } from "../../src/testing";

const NAMES = laneNames("admorg");

function okOrThrow(result: ResolveOrganizationResult): AdminOrganization {
  if (!result.ok) {
    throw new Error(`expected a resolved organization, got refusal: ${result.reason}`);
  }
  return result.organization;
}

function refusalOrThrow(
  result: ResolveOrganizationResult,
): Extract<ResolveOrganizationResult, { ok: false }> {
  if (result.ok) {
    throw new Error(`expected a refusal, got organization: ${result.organization.id}`);
  }
  return result;
}

async function slugOf(db: TestDb, organizationId: string): Promise<string> {
  const [row] = await db
    .select({ slug: schema.organization.slug })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId));
  if (!row) {
    throw new Error("slugOf: seeded organization row not found");
  }
  return row.slug;
}

describe("resolveOrganizationForCli", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
  });

  afterEach(async () => {
    await close();
  });

  it("should resolve the only organization without being told which", async () => {
    const seeded = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("only"),
      userName: NAMES.userName("only"),
      email: NAMES.email("only"),
    });

    const organization = okOrThrow(await resolveOrganizationForCli(db, {}));

    expect(organization.id).toBe(seeded.organizationId);
    expect(organization.name).toBe(seeded.organizationName);
    expect(organization.slug).toBe(await slugOf(db, seeded.organizationId));

    expect(organization.ownerUserId).toBe(seeded.userId);
    expect(organization.ownerEmail).toBe(NAMES.email("only"));
  });

  it("should refuse to guess when more than one organization exists, and name them all", async () => {
    const first = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("ambiguous-one"),
      userName: NAMES.userName("ambiguous-one"),
      email: NAMES.email("ambiguous-one"),
    });
    const second = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("ambiguous-two"),
      userName: NAMES.userName("ambiguous-two"),
      email: NAMES.email("ambiguous-two"),
    });

    const refusal = refusalOrThrow(await resolveOrganizationForCli(db, {}));

    expect(refusal.reason).toBe("ambiguous");

    expect(refusal.candidates.map((candidate) => candidate.id).toSorted()).toEqual(
      [first.organizationId, second.organizationId].toSorted(),
    );
    for (const candidate of refusal.candidates) {
      expect(candidate.name.length).toBeGreaterThan(0);
      expect(candidate.slug.length).toBeGreaterThan(0);
    }
  });

  it("should refuse when the named organization does not exist", async () => {
    const seeded = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("not-found"),
      userName: NAMES.userName("not-found"),
      email: NAMES.email("not-found"),
    });

    const refusal = refusalOrThrow(
      await resolveOrganizationForCli(db, { org: "no-such-organization" }),
    );

    expect(refusal.reason).toBe("not_found");
    expect(refusal.candidates.map((candidate) => candidate.id)).toContain(seeded.organizationId);
  });

  it("should refuse when no organization exists at all", async () => {
    const refusal = refusalOrThrow(await resolveOrganizationForCli(db, {}));

    expect(refusal.reason).toBe("none_exist");
    expect(refusal.candidates).toEqual([]);

    expect(await db.select().from(schema.organization)).toEqual([]);
  });

  it("should refuse an organization with no owner rather than resolving without one", async () => {
    const organization = await seedOrganization(db, { name: NAMES.orgName("no-owner") });
    const user = await seedUser(db, {
      name: NAMES.userName("no-owner"),
      email: NAMES.email("no-owner"),
    });

    await seedMember(db, {
      organizationId: organization.id,
      userId: user.id,
      role: "member",
    });

    const refusal = refusalOrThrow(await resolveOrganizationForCli(db, {}));

    expect(refusal.reason).toBe("no_owner");

    expect(
      await db
        .select()
        .from(schema.organization)
        .where(eq(schema.organization.id, organization.id)),
    ).toHaveLength(1);
  });

  it("should act as the earliest owner when an organization has more than one", async () => {
    const organization = await seedOrganization(db, { name: NAMES.orgName("two-owners") });
    const earlier = await seedUser(db, {
      name: NAMES.userName("two-owners-earlier"),
      email: NAMES.email("two-owners-earlier"),
    });
    const later = await seedUser(db, {
      name: NAMES.userName("two-owners-later"),
      email: NAMES.email("two-owners-later"),
    });

    await seedMember(db, {
      organizationId: organization.id,
      userId: later.id,
      role: "owner",
      createdAt: new Date("2026-02-01T00:00:00.000Z"),
    });
    await seedMember(db, {
      organizationId: organization.id,
      userId: earlier.id,
      role: "owner",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const resolved = okOrThrow(await resolveOrganizationForCli(db, {}));

    expect(resolved.ownerUserId).toBe(earlier.id);
    expect(resolved.ownerEmail).toBe(NAMES.email("two-owners-earlier"));

    expect(resolved.ownerUserId).not.toBe(later.id);
  });

  it("should break a createdAt tie on member id rather than on row order", async () => {
    const organization = await seedOrganization(db, { name: NAMES.orgName("tied-owners") });
    const first = await seedUser(db, {
      name: NAMES.userName("tied-owners-one"),
      email: NAMES.email("tied-owners-one"),
    });
    const second = await seedUser(db, {
      name: NAMES.userName("tied-owners-two"),
      email: NAMES.email("tied-owners-two"),
    });

    const tiedAt = new Date("2026-03-01T00:00:00.000Z");
    const firstMember = await seedMember(db, {
      organizationId: organization.id,
      userId: first.id,
      role: "owner",
      createdAt: tiedAt,
    });
    const secondMember = await seedMember(db, {
      organizationId: organization.id,
      userId: second.id,
      role: "owner",
      createdAt: tiedAt,
    });

    const expectedUserId = firstMember.id < secondMember.id ? first.id : second.id;

    const resolved = okOrThrow(await resolveOrganizationForCli(db, {}));
    expect(resolved.ownerUserId).toBe(expectedUserId);

    expect(okOrThrow(await resolveOrganizationForCli(db, {}))).toEqual(resolved);
  });

  it("should treat an owner with no email as no owner at all", async () => {
    const organization = await seedOrganization(db, { name: NAMES.orgName("empty-email") });
    const user = await seedUser(db, { name: NAMES.userName("empty-email"), email: "" });
    await seedMember(db, {
      organizationId: organization.id,
      userId: user.id,
      role: "owner",
    });

    const refusal = refusalOrThrow(await resolveOrganizationForCli(db, {}));

    expect(refusal.reason).toBe("no_owner");

    const candidate = refusal.candidates.find((row) => row.id === organization.id);
    expect(candidate).toBeDefined();
    expect(candidate?.ownerEmail).toBeNull();

    const [member] = await db
      .select()
      .from(schema.member)
      .where(eq(schema.member.organizationId, organization.id));
    expect(member?.userId).toBe(user.id);
    expect(member?.role).toBe("owner");
  });

  it("should resolve by slug as well as by id", async () => {
    const target = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("by-slug-target"),
      userName: NAMES.userName("by-slug-target"),
      email: NAMES.email("by-slug-target"),
    });

    await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("by-slug-other"),
      userName: NAMES.userName("by-slug-other"),
      email: NAMES.email("by-slug-other"),
    });
    const slug = await slugOf(db, target.organizationId);

    const byId = okOrThrow(await resolveOrganizationForCli(db, { org: target.organizationId }));
    const bySlug = okOrThrow(await resolveOrganizationForCli(db, { org: slug }));

    expect(byId.id).toBe(target.organizationId);
    expect(bySlug).toEqual(byId);

    expect(refusalOrThrow(await resolveOrganizationForCli(db, {})).reason).toBe("ambiguous");
  });
});
