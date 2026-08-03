import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { sql, type SQL } from "drizzle-orm";

import {
  loadUnderConstruction,
  underConstructionSpecifier,
} from "../../../shared/__tests__/onboarding/module-under-construction";
import type { ScopedDb } from "../../src/repositories/types";
import { createTestDb, laneNames, seedOrgWithOwner, type TestDb } from "../../src/testing";
import { readRawRows } from "../helpers/onboarding-contract";

const NAMES = laneNames("provider-interest-system");

const OWNER = "O-024 ADD AD-2/AD-3 (packages/db/src/system/provider-interest.ts)";

const MODULE = underConstructionSpecifier("packages/db/src/system/provider-interest");

const NOW = new Date("2026-08-03T12:00:00.000Z");
const NOTIFIED_EARLIER = new Date("2026-08-02T09:00:00.000Z");
const SEEDED_AT = new Date("2026-08-01T08:00:00.000Z");

// Wave 0 contract shapes (AD-2/AD-3) — production types arrive with the system module.
interface ClaimedProviderInterest {
  readonly id: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly provider: string;
  readonly notifiedAt: Date;
}

type ClaimUnnotifiedProviderInterest = (
  db: ScopedDb,
  now: Date,
) => Promise<ClaimedProviderInterest[]>;

type CountProviderInterest = (db: ScopedDb, provider: string) => Promise<number>;

const loadClaim = (): Promise<ClaimUnnotifiedProviderInterest> =>
  loadUnderConstruction<ClaimUnnotifiedProviderInterest>({
    modulePath: MODULE,
    exportName: "claimUnnotifiedProviderInterest",
    ownedBy: OWNER,
  });

const loadCount = (): Promise<CountProviderInterest> =>
  loadUnderConstruction<CountProviderInterest>({
    modulePath: MODULE,
    exportName: "countProviderInterest",
    ownedBy: OWNER,
  });

const tstz = (value: Date): SQL => sql`${value.toISOString()}::timestamptz`;

// requested_by is audit-only with no user FK (AD-3), so a synthetic id must persist.
async function seedInterestRow(
  db: TestDb,
  row: { organizationId: string; provider: string; notifiedAt?: Date },
): Promise<string> {
  const id = randomUUID();
  await readRawRows(
    db,
    sql`insert into provider_interest
          (id, organization_id, provider, requested_by, notified_at, created_at, updated_at)
        values (${id}, ${row.organizationId}, ${row.provider}, ${"o24-seed-requester"},
          ${row.notifiedAt ? tstz(row.notifiedAt) : sql`null`}, ${tstz(SEEDED_AT)}, ${tstz(SEEDED_AT)})`,
  );
  return id;
}

describe("claimUnnotifiedProviderInterest — the notified_at stamp is the claim", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("one sweep takes each unnotified row exactly once, stamped and org-named; the next sweep takes none", async () => {
    const claimUnnotifiedProviderInterest = await loadClaim();
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("sweep"),
      userName: NAMES.userName("sweep"),
      email: NAMES.email("sweep"),
    });
    const unnotifiedA = await seedInterestRow(db, {
      organizationId: org.organizationId,
      provider: "mixpanel",
    });
    const unnotifiedB = await seedInterestRow(db, {
      organizationId: org.organizationId,
      provider: "github",
    });
    const alreadyNotified = await seedInterestRow(db, {
      organizationId: org.organizationId,
      provider: "cursor",
      notifiedAt: NOTIFIED_EARLIER,
    });

    const claimed = await claimUnnotifiedProviderInterest(db, NOW);

    expect(claimed.map((row) => row.id).sort()).toEqual([unnotifiedA, unnotifiedB].sort());
    expect(claimed.map((row) => row.provider).sort()).toEqual(["github", "mixpanel"]);
    for (const row of claimed) {
      expect(row.notifiedAt.getTime()).toBe(NOW.getTime());
      expect(row.organizationId).toBe(org.organizationId);
      expect(row.organizationName).toBe(NAMES.orgName("sweep"));
    }

    expect(await claimUnnotifiedProviderInterest(db, NOW)).toEqual([]);

    const untouched = await readRawRows(
      db,
      sql`select notified_at from provider_interest where id = ${alreadyNotified}`,
    );
    const keptStamp = untouched[0]?.notified_at;
    expect(new Date(keptStamp as string | number | Date).getTime()).toBe(
      NOTIFIED_EARLIER.getTime(),
    );
  });
});

describe("countProviderInterest — the cross-org running total", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("counts every org's rows for the provider, notified or not, and zero when none exist", async () => {
    const countProviderInterest = await loadCount();
    const orgA = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("count-a"),
      userName: NAMES.userName("count-a"),
      email: NAMES.email("count-a"),
    });
    const orgB = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("count-b"),
      userName: NAMES.userName("count-b"),
      email: NAMES.email("count-b"),
    });

    await seedInterestRow(db, { organizationId: orgA.organizationId, provider: "mixpanel" });
    await seedInterestRow(db, {
      organizationId: orgB.organizationId,
      provider: "mixpanel",
      notifiedAt: NOTIFIED_EARLIER,
    });
    await seedInterestRow(db, { organizationId: orgA.organizationId, provider: "github" });

    expect(await countProviderInterest(db, "mixpanel")).toBe(2);
    expect(await countProviderInterest(db, "github")).toBe(1);
    expect(await countProviderInterest(db, "windsurf")).toBe(0);
  });
});
