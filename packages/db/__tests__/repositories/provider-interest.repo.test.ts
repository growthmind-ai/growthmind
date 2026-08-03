import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { TenantContext } from "@growthmind/shared";
import { sql } from "drizzle-orm";

import {
  loadUnderConstruction,
  underConstructionSpecifier,
} from "../../../shared/__tests__/onboarding/module-under-construction";
import type { ScopedDb } from "../../src/repositories/types";
import {
  createTestDb,
  laneNames,
  makeTenantContext,
  seedMember,
  seedOrgWithOwner,
  seedUser,
  type TestDb,
} from "../../src/testing";
import { readRawRows } from "../helpers/onboarding-contract";

const NAMES = laneNames("provider-interest");

const OWNER = "O-024 ADD AD-3 (packages/db/src/repositories/provider-interest.repo.ts)";

// Wave 0 contract shapes (AD-3) — production types arrive with the repository.
interface ProviderInterestNote {
  readonly claimed: boolean;
}

interface ProviderInterestRepo {
  note(provider: string, requestedBy: string): Promise<ProviderInterestNote>;
  listNotedProviders(): Promise<readonly string[]>;
}

type CreateProviderInterestRepo = (db: ScopedDb, ctx: TenantContext) => ProviderInterestRepo;

const loadCreateRepo = (): Promise<CreateProviderInterestRepo> =>
  loadUnderConstruction<CreateProviderInterestRepo>({
    modulePath: underConstructionSpecifier("packages/db/src/repositories/provider-interest.repo"),
    exportName: "createProviderInterestRepo",
    ownedBy: OWNER,
  });

interface Scope {
  organizationId: string;
  owner: TenantContext;
  ownerUserId: string;
  teammate: TenantContext;
  teammateUserId: string;
}

async function seedScope(db: TestDb, label: string): Promise<Scope> {
  const org = await seedOrgWithOwner(db, {
    orgName: NAMES.orgName(label),
    userName: NAMES.userName(label),
    email: NAMES.email(label),
  });
  const mate = await seedUser(db, {
    name: NAMES.userName(`${label}-mate`),
    email: NAMES.email(`${label}-mate`),
  });
  await seedMember(db, {
    organizationId: org.organizationId,
    userId: mate.id,
    role: "member",
  });

  return {
    organizationId: org.organizationId,
    owner: org.ctx,
    ownerUserId: org.userId,
    teammateUserId: mate.id,
    teammate: makeTenantContext({
      userId: mate.id,
      organizationId: org.organizationId,
      organizationName: org.organizationName,
      role: "member",
    }),
  };
}

describe("provider_interest — the org's demand note, written once per provider", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  test("note() first insert returns claimed=true and the persisted row carries the caller's organization_id", async () => {
    const createProviderInterestRepo = await loadCreateRepo();
    const scope = await seedScope(db, "first-insert");
    const provider = "mixpanel";

    const result = await createProviderInterestRepo(db, scope.owner).note(
      provider,
      scope.ownerUserId,
    );
    expect(result.claimed).toBe(true);

    const rows = await readRawRows(
      db,
      sql`select organization_id from provider_interest where provider = ${provider}`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.organization_id).toBe(scope.organizationId);
  });

  test("note() repeated and rage-repeated five times returns claimed=false and leaves exactly one row", async () => {
    const createProviderInterestRepo = await loadCreateRepo();
    const scope = await seedScope(db, "repeat");
    const repo = createProviderInterestRepo(db, scope.owner);
    const provider = "github";

    expect((await repo.note(provider, scope.ownerUserId)).claimed).toBe(true);
    expect((await repo.note(provider, scope.ownerUserId)).claimed).toBe(false);

    const rage = await Promise.all(
      Array.from({ length: 5 }, () => repo.note(provider, scope.ownerUserId)),
    );
    for (const attempt of rage) {
      expect(attempt.claimed).toBe(false);
    }

    const rows = await readRawRows(
      db,
      sql`select id from provider_interest where provider = ${provider}`,
    );
    expect(rows).toHaveLength(1);
  });

  test("two members noting the same provider concurrently both succeed, produce one row, one claim", async () => {
    const createProviderInterestRepo = await loadCreateRepo();
    const scope = await seedScope(db, "concurrent");
    const provider = "cursor";

    const results = await Promise.all([
      createProviderInterestRepo(db, scope.owner).note(provider, scope.ownerUserId),
      createProviderInterestRepo(db, scope.teammate).note(provider, scope.teammateUserId),
    ]);

    expect(results.filter((result) => result.claimed)).toHaveLength(1);

    const rows = await readRawRows(
      db,
      sql`select id from provider_interest where provider = ${provider}`,
    );
    expect(rows).toHaveLength(1);
  });

  test("listNotedProviders returns the org's notes to any member and never another org's", async () => {
    const createProviderInterestRepo = await loadCreateRepo();
    const orgA = await seedScope(db, "tenant-a");
    const orgB = await seedScope(db, "tenant-b");

    await createProviderInterestRepo(db, orgA.owner).note("amplitude", orgA.ownerUserId);
    await createProviderInterestRepo(db, orgB.owner).note("windsurf", orgB.ownerUserId);

    expect(await createProviderInterestRepo(db, orgA.owner).listNotedProviders()).toEqual([
      "amplitude",
    ]);
    expect(await createProviderInterestRepo(db, orgA.teammate).listNotedProviders()).toEqual([
      "amplitude",
    ]);
    expect(await createProviderInterestRepo(db, orgB.owner).listNotedProviders()).toEqual([
      "windsurf",
    ]);
  });

  test("a note requested by one member lists for another member — requested_by filters no read", async () => {
    const createProviderInterestRepo = await loadCreateRepo();
    const scope = await seedScope(db, "audit-only");
    const provider = "claude-code";

    await createProviderInterestRepo(db, scope.owner).note(provider, scope.ownerUserId);

    const authored = await readRawRows(
      db,
      sql`select requested_by from provider_interest where provider = ${provider}`,
    );
    expect(authored[0]?.requested_by).toBe(scope.ownerUserId);

    const listedForTeammate = await createProviderInterestRepo(
      db,
      scope.teammate,
    ).listNotedProviders();
    expect(listedForTeammate).toContain(provider);
  });
});
