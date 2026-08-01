// Wave 0b (red), lane L3, fixture seed prefix `db-`. Add
// tasks/session-source-posthog-adapter/add.md items 88–89, / /.
//
// The cron line fires every minute and runs can overlap, so the claim IS the lock: one
// `UPDATE … WHERE is_active AND next_poll_at <= $now RETURNING …` that pushes
// `next_poll_at` forward as it selects. There is no read-then-write window anywhere,
// which is the only reason two overlapping ticks cannot poll one connection twice and
// double-count its events.
//
// `claimDuePollableConnections` is a typed-stub throw today, so every test here fails
// on "not implemented".
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { claimDuePollableConnections } from "../../src/system";
import { createTestDb, type TestDb } from "../../src/testing";
import { laneNames } from "../helpers/db-lane-fixtures";
import { seedConnection, seedOrgWithOwner, seedProject } from "../helpers/fixtures";

const NAMES = laneNames("claim");

const NOW = new Date("2026-07-30T12:00:00.000Z");
const DUE_AT = new Date("2026-07-30T11:59:00.000Z");
const NOT_DUE_UNTIL = new Date("2026-07-30T12:05:00.000Z");

async function seedDueConnection(
  db: TestDb,
  label: string,
  overrides: { isActive?: boolean; nextPollAt?: Date; pollIntervalSeconds?: number } = {},
): Promise<{ organizationId: string; projectId: string; connectionId: string }> {
  const org = await seedOrgWithOwner(db, {
    orgName: NAMES.orgName(label),
    userName: NAMES.userName(label),
    email: NAMES.email(label),
  });
  const project = await seedProject(db, {
    organizationId: org.organizationId,
    name: NAMES.projectName(label),
  });
  const connection = await seedConnection(db, {
    organizationId: org.organizationId,
    projectId: project.id,
    isActive: overrides.isActive ?? true,
    nextPollAt: overrides.nextPollAt ?? DUE_AT,
    pollIntervalSeconds: overrides.pollIntervalSeconds ?? 60,
  });

  return {
    organizationId: org.organizationId,
    projectId: project.id,
    connectionId: connection.id,
  };
}

describe("claimDuePollableConnections", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  // -- item 88
  it("never returns the same connection to two concurrent claims", async () => {
    const seeded = await seedDueConnection(db, "concurrent");

    const [first, second] = await Promise.all([
      claimDuePollableConnections(db, { now: NOW, limit: 10 }),
      claimDuePollableConnections(db, { now: NOW, limit: 10 }),
    ]);

    const claims = [...first, ...second].filter((row) => row.id === seeded.connectionId);
    // Exactly one of the two overlapping ticks may own it. Two would mean two polls of
    // the same window, and every event counted twice.
    expect(claims).toHaveLength(1);
  });

  // -- item 88 (the claim moves the cursor)
  it("does not hand the same connection back to an immediately following claim", async () => {
    const seeded = await seedDueConnection(db, "sequential");

    const first = await claimDuePollableConnections(db, { now: NOW, limit: 10 });
    expect(first.map((row) => row.id)).toContain(seeded.connectionId);

    // The claim itself pushed `next_poll_at` forward by the interval, so the next tick
    // at the same instant finds nothing due.
    const second = await claimDuePollableConnections(db, { now: NOW, limit: 10 });
    expect(second.map((row) => row.id)).not.toContain(seeded.connectionId);

    // Once the interval has elapsed it becomes claimable again.
    const later = await claimDuePollableConnections(db, {
      now: new Date(NOW.getTime() + 120_000),
      limit: 10,
    });
    expect(later.map((row) => row.id)).toContain(seeded.connectionId);
  });

  // -- item 88 (limit)
  it("claims no more than the requested limit and leaves the remainder due", async () => {
    const one = await seedDueConnection(db, "limit-one");
    const two = await seedDueConnection(db, "limit-two");

    const claimed = await claimDuePollableConnections(db, { now: NOW, limit: 1 });
    const mine = claimed.filter((row) => [one.connectionId, two.connectionId].includes(row.id));
    expect(mine).toHaveLength(1);

    // Nothing is lost: the one that missed out is still due on the next tick.
    const next = await claimDuePollableConnections(db, { now: NOW, limit: 10 });
    const remaining = next.filter((row) => [one.connectionId, two.connectionId].includes(row.id));
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).not.toBe(mine[0]?.id);
  });

  // -- item 89
  it("returns nothing for a connection that is not active", async () => {
    const seeded = await seedDueConnection(db, "inactive", { isActive: false });

    const claimed = await claimDuePollableConnections(db, { now: NOW, limit: 10 });
    expect(claimed.map((row) => row.id)).not.toContain(seeded.connectionId);
  });

  // -- item 89
  it("returns nothing for a connection that is not yet due", async () => {
    const seeded = await seedDueConnection(db, "not-due", { nextPollAt: NOT_DUE_UNTIL });

    const claimed = await claimDuePollableConnections(db, { now: NOW, limit: 10 });
    expect(claimed.map((row) => row.id)).not.toContain(seeded.connectionId);
  });

  // -- item 89 (empty is clean, not a crash)
  it("returns an empty list rather than failing when nothing is due", async () => {
    const claimed = await claimDuePollableConnections(db, {
      now: new Date("2020-01-01T00:00:00.000Z"),
      limit: 10,
    });
    expect(claimed).toEqual([]);
  });

  // -- item 89 (the claimed shape carries what the poll needs)
  it("carries the organization name and source config the poll runs on", async () => {
    const seeded = await seedDueConnection(db, "shape");

    const claimed = await claimDuePollableConnections(db, { now: NOW, limit: 10 });
    const mine = claimed.find((row) => row.id === seeded.connectionId);
    expect(mine).toBeDefined();
    expect(mine?.organizationId).toBe(seeded.organizationId);
    expect(mine?.projectId).toBe(seeded.projectId);
    expect(mine?.sourceKind).toBe("posthog");
    expect(mine?.host).toBe("https://eu.posthog.example.invalid");
    expect(mine?.sourceProjectId).toBe("00000");
    // Joined so the system context can be built without a second query.
    expect(mine?.organizationName).toBe(NAMES.orgName("shape"));
    expect(mine?.pollIntervalSeconds).toBe(60);
    expect(mine?.watermarkAt).toBeNull();
  });
});
