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
