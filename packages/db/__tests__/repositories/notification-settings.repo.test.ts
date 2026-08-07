// O-051 job 2 (ADD D-6): absence is the default — no seed row, no backfill — so an org
// nobody has configured reads weekly/monday, and the one row per org is the primary key
// rather than a convention. RED in Wave 0 against the throwing repo stubs.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";

import { DIGEST_CADENCE_DEFAULT, DIGEST_DAY_DEFAULT } from "@growthmind/shared";

import { createNotificationSettingsRepo } from "../../src/repositories/notification-settings.repo";
import {
  createTestDb,
  laneNames,
  seedOrgWithOwner,
  type SeededOrgWithOwner,
  type TestDb,
} from "../../src/testing";

const NAMES = laneNames("notification-settings");

let db: TestDb;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

async function seedOrg(label: string): Promise<SeededOrgWithOwner> {
  return seedOrgWithOwner(db, {
    orgName: NAMES.orgName(label),
    userName: NAMES.userName(label),
    email: NAMES.email(label),
  });
}

async function settingsRowCount(organizationId: string): Promise<number> {
  const result = await db.execute(sql`
    select organization_id from notification_settings where organization_id = ${organizationId}
  `);
  return (result as unknown as { rows: unknown[] }).rows.length;
}

describe("digest settings round-trip and default with no row present", () => {
  test("a read with no row yields the documented defaults and writes nothing", async () => {
    const org = await seedOrg("defaults");

    expect(await createNotificationSettingsRepo(db, org.ctx).read()).toEqual({
      digestCadence: DIGEST_CADENCE_DEFAULT,
      digestDay: DIGEST_DAY_DEFAULT,
    });

    // The default is applied by the reader, never seeded: a workspace nobody configured
    // holds no row at all (the LEFT JOIN population, ADD D-8).
    expect(await settingsRowCount(org.organizationId)).toBe(0);
  });

  test("a save round-trips and a second save updates the same single row", async () => {
    const org = await seedOrg("round-trip");
    const repo = createNotificationSettingsRepo(db, org.ctx);

    expect(await repo.save({ cadence: "weekly", day: "friday" })).toEqual({
      digestCadence: "weekly",
      digestDay: "friday",
    });
    expect(await repo.read()).toEqual({ digestCadence: "weekly", digestDay: "friday" });
    expect(await settingsRowCount(org.organizationId)).toBe(1);

    await repo.save({ cadence: "off", day: "tuesday" });
    expect(await repo.read()).toEqual({ digestCadence: "off", digestDay: "tuesday" });
    expect(await settingsRowCount(org.organizationId)).toBe(1);
  });

  test("another organization's settings are never returned", async () => {
    const orgA = await seedOrg("tenant-a");
    const orgB = await seedOrg("tenant-b");

    await createNotificationSettingsRepo(db, orgA.ctx).save({ cadence: "weekly", day: "sunday" });

    expect(await createNotificationSettingsRepo(db, orgB.ctx).read()).toEqual({
      digestCadence: DIGEST_CADENCE_DEFAULT,
      digestDay: DIGEST_DAY_DEFAULT,
    });

    await createNotificationSettingsRepo(db, orgB.ctx).save({ cadence: "off", day: "saturday" });
    expect(await createNotificationSettingsRepo(db, orgA.ctx).read()).toEqual({
      digestCadence: "weekly",
      digestDay: "sunday",
    });
  });
});
