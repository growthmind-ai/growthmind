// O-051 job 2 (ADD D-6): absence is the default — no seed row, no backfill — so an org
// nobody has configured reads weekly/monday, and the one row per org is the primary key
// rather than a convention. RED in Wave 0 against the throwing repo stubs.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import {
  DIGEST_CADENCE_DEFAULT,
  DIGEST_DAY_DEFAULT,
  VERDICT_WINDOW_DAYS_DEFAULT,
} from "@growthmind/shared";

import { createNotificationSettingsRepo } from "../../src/repositories/notification-settings.repo";
import { notificationSettings } from "../../src/schema/notification-settings";
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
      verdictWindowDays: VERDICT_WINDOW_DAYS_DEFAULT,
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
      verdictWindowDays: VERDICT_WINDOW_DAYS_DEFAULT,
    });
    expect(await repo.read()).toEqual({
      digestCadence: "weekly",
      digestDay: "friday",
      verdictWindowDays: VERDICT_WINDOW_DAYS_DEFAULT,
    });
    expect(await settingsRowCount(org.organizationId)).toBe(1);

    await repo.save({ cadence: "off", day: "tuesday" });
    expect(await repo.read()).toEqual({
      digestCadence: "off",
      digestDay: "tuesday",
      verdictWindowDays: VERDICT_WINDOW_DAYS_DEFAULT,
    });
    expect(await settingsRowCount(org.organizationId)).toBe(1);
  });

  test("another organization's settings are never returned", async () => {
    const orgA = await seedOrg("tenant-a");
    const orgB = await seedOrg("tenant-b");

    await createNotificationSettingsRepo(db, orgA.ctx).save({ cadence: "weekly", day: "sunday" });

    expect(await createNotificationSettingsRepo(db, orgB.ctx).read()).toEqual({
      digestCadence: DIGEST_CADENCE_DEFAULT,
      digestDay: DIGEST_DAY_DEFAULT,
      verdictWindowDays: VERDICT_WINDOW_DAYS_DEFAULT,
    });

    await createNotificationSettingsRepo(db, orgB.ctx).save({ cadence: "off", day: "saturday" });
    expect(await createNotificationSettingsRepo(db, orgA.ctx).read()).toEqual({
      digestCadence: "weekly",
      digestDay: "sunday",
      verdictWindowDays: VERDICT_WINDOW_DAYS_DEFAULT,
    });
  });
});

// O-053 HC-4 (.ai/decisions/0027): the verdict window is configurable in days on this same
// one-row-per-org table, and absence is the default — no seed row, no backfill, no settings
// UI. RED in Wave 0: the column and the read field are Wave 2's.
describe("the verdict window is configured here, and its absence is the default", () => {
  const STORED_WINDOW_DAYS = 3;

  test("a read with no settings row yields the seven-day default and writes nothing", async () => {
    const org = await seedOrg("verdict-window-default");

    expect((await createNotificationSettingsRepo(db, org.ctx).read()).verdictWindowDays).toBe(
      VERDICT_WINDOW_DAYS_DEFAULT,
    );
    expect(await settingsRowCount(org.organizationId)).toBe(0);
  });

  test("a row that configures nothing still reads as the default", async () => {
    const org = await seedOrg("verdict-window-untouched");
    const repo = createNotificationSettingsRepo(db, org.ctx);

    await repo.save({ cadence: "weekly", day: "monday" });

    expect(await settingsRowCount(org.organizationId)).toBe(1);
    expect((await repo.read()).verdictWindowDays).toBe(VERDICT_WINDOW_DAYS_DEFAULT);
  });

  test("a stored window is what the lapse scan reads, and it is not the default", async () => {
    const org = await seedOrg("verdict-window-stored");
    const repo = createNotificationSettingsRepo(db, org.ctx);

    await repo.save({ cadence: "weekly", day: "monday" });
    await db
      .update(notificationSettings)
      .set({ verdictWindowDays: STORED_WINDOW_DAYS })
      .where(eq(notificationSettings.organizationId, org.organizationId));

    // Non-vacuity: a stored value equal to the default would pass while the read ignored the
    // column entirely.
    expect(STORED_WINDOW_DAYS).not.toBe(VERDICT_WINDOW_DAYS_DEFAULT);
    expect((await repo.read()).verdictWindowDays).toBe(STORED_WINDOW_DAYS);
  });

  test("one organization's window never becomes another's", async () => {
    const configured = await seedOrg("verdict-window-tenant-a");
    const untouched = await seedOrg("verdict-window-tenant-b");

    await createNotificationSettingsRepo(db, configured.ctx).save({
      cadence: "weekly",
      day: "monday",
    });
    await db
      .update(notificationSettings)
      .set({ verdictWindowDays: STORED_WINDOW_DAYS })
      .where(eq(notificationSettings.organizationId, configured.organizationId));

    expect((await createNotificationSettingsRepo(db, untouched.ctx).read()).verdictWindowDays).toBe(
      VERDICT_WINDOW_DAYS_DEFAULT,
    );
  });
});
