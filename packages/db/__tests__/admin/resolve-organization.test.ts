// Wave 0 (RED) — O-009 `mcp-read-credential`, ADD §8 "Integration tests —
// admin organisation resolution (PGlite, lane `admorg`)", all 6 rows.
//
// Subject: `packages/db/src/admin/organizations.ts` → `resolveOrganizationForCli`
// (ADD D-9), imported through the `src/admin` barrel because that is the
// surface `scripts/` reaches via the `"./admin"` subpath. It does not exist
// yet, so this suite is red at module resolution until Wave 3.
//
// Lane discipline (ADD D-6): `packages/db` lane, seeded through
// `__tests__/helpers/fixtures.ts`, fixture prefix `admorg`.
//
// Each row gets its OWN PGlite database. The function's whole job is deciding
// what to do with the number of organisations that exist, so "how many exist"
// is the input under test — a shared database would let one row's seeding
// silently answer another row's question.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";

import {
  resolveOrganizationForCli,
  type AdminOrganization,
  type ResolveOrganizationResult,
} from "../../src/admin";
import * as schema from "../../src/schema";
import { createTestDb, type TestDb } from "../../src/testing";
import { laneNames } from "../helpers/db-lane-fixtures";
import { seedMember, seedOrganization, seedOrgWithOwner, seedUser } from "../helpers/fixtures";

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

/** `seedOrgWithOwner` does not surface the generated slug, and OQ-1's slug
 * row needs it — so it is read back from the row it just wrote. */
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

    // A count of exactly one is not a pick — it is the only possible answer,
    // and it is what makes minting a genuine one-command flow (OQ-2).
    const organization = okOrThrow(await resolveOrganizationForCli(db, {}));

    expect(organization.id).toBe(seeded.organizationId);
    expect(organization.name).toBe(seeded.organizationName);
    expect(organization.slug).toBe(await slugOf(db, seeded.organizationId));
    // The owner comes back WITH the organisation, in the same call — that is
    // what makes `no_owner` a resolution failure the caller cannot forget.
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
    // Every candidate, not just the first — the operator has to be able to
    // pass `--org <id>` without going to the database themselves.
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

    // Never a fallback to "the only one" when the operator named something
    // else — an explicit `--org` that misses is a refusal, not a hint.
    expect(refusal.reason).toBe("not_found");
    expect(refusal.candidates.map((candidate) => candidate.id)).toContain(seeded.organizationId);
  });

  it("should refuse when no organization exists at all", async () => {
    const refusal = refusalOrThrow(await resolveOrganizationForCli(db, {}));

    expect(refusal.reason).toBe("none_exist");
    expect(refusal.candidates).toEqual([]);
    // Never creates an organisation to have something to mint against.
    expect(await db.select().from(schema.organization)).toEqual([]);
  });

  it("should refuse an organization with no owner rather than resolving without one", async () => {
    const organization = await seedOrganization(db, { name: NAMES.orgName("no-owner") });
    const user = await seedUser(db, {
      name: NAMES.userName("no-owner"),
      email: NAMES.email("no-owner"),
    });
    // A plain member, not an owner — Better Auth's shape after the owner
    // leaves. The CLI builds a real owner `TenantContext`, so with no owner
    // there is nothing truthful to build it from.
    await seedMember(db, {
      organizationId: organization.id,
      userId: user.id,
      role: "member",
    });

    const refusal = refusalOrThrow(await resolveOrganizationForCli(db, {}));

    expect(refusal.reason).toBe("no_owner");
    // Not vacuous: the organisation is genuinely there and would have been
    // the single auto-resolved answer if an owner existed.
    expect(
      await db
        .select()
        .from(schema.organization)
        .where(eq(schema.organization.id, organization.id)),
    ).toHaveLength(1);
  });

  // ── WHICH OWNER (readOwners) ──────────────────────────────────────────────
  // The three rows below cover `readOwners`' selection rule, which every row
  // above leaves untested by seeding exactly one owner per organisation. This
  // is not a cosmetic gap: `ownerUserId` becomes `ctx.userId` in the
  // `TenantContext` the mint runs under, so a regression here mints a
  // credential as the WRONG PERSON with nothing failing.

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

    // The LATER owner is inserted FIRST, so physical row order cannot be what
    // answers below — only `member.createdAt` can.
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
    // Non-vacuity: the other owner is genuinely an owner of the same
    // organisation, so this row really did choose between two candidates.
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

    // Identical `createdAt` — the realistic shape when two owners are seeded by
    // the same migration or the same transaction.
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

    // Whichever member id sorts first is the documented answer. Computed from
    // the seeded ids rather than hardcoded, because they are random UUIDs —
    // the point is that the answer is DETERMINED, not that it is any
    // particular person.
    const expectedUserId = firstMember.id < secondMember.id ? first.id : second.id;

    const resolved = okOrThrow(await resolveOrganizationForCli(db, {}));
    expect(resolved.ownerUserId).toBe(expectedUserId);

    // And it is stable: the same database answers the same way twice, so a
    // re-run never quietly mints as the other person.
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

    // Same fail direction `creatorEmail()` documents: infer NOTHING rather than
    // act as somebody who is not really there. A CLI that mints as a
    // half-present actor is worse than one that refuses.
    expect(refusal.reason).toBe("no_owner");
    // The organisation is still named, so the operator can see WHY it refused.
    const candidate = refusal.candidates.find((row) => row.id === organization.id);
    expect(candidate).toBeDefined();
    expect(candidate?.ownerEmail).toBeNull();

    // Non-vacuity: the membership genuinely exists AND genuinely carries the
    // owner role, so the refusal is the empty-email rule and not a missing or
    // mis-roled member row.
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
    // A second organisation, so auto-resolve cannot be what answers below —
    // `{}` here would be `ambiguous`. Only the explicit `--org` can resolve.
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
    // Non-vacuity for the "second org" guard: without `--org` this database
    // is genuinely ambiguous, so neither answer above came from a count of one.
    expect(refusalOrThrow(await resolveOrganizationForCli(db, {})).reason).toBe("ambiguous");
  });
});
