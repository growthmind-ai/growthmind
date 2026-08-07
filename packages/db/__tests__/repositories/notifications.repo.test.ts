// The bell's read model (ADD D-5): the read predicate has exactly one home — the SQL of
// listRecentWithReadState — the badge is a deliberately different fact, and both watermarks
// only ever move forward. RED in Wave 0 against the throwing repo stubs.
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import type { TenantContext } from "@growthmind/shared";

import { createNotificationsRepo } from "../../src/repositories/notifications.repo";
import { notificationBellState, notificationReads } from "../../src/schema/notifications";
import {
  createTestDb,
  laneNames,
  makeTenantContext,
  seedMember,
  seedNotification,
  seedOrgWithOwner,
  seedUser,
  type SeededOrgWithOwner,
  type TestDb,
} from "../../src/testing";

const NAMES = laneNames("notifications-repo");

const LIST = { limit: 20, windowDays: 30 } as const;

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

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

function repoFor(ctx: TenantContext) {
  return createNotificationsRepo(db, ctx);
}

// The repository refuses machine principals for bell-state writes; per-person read state
// belongs to people (ADD §6 — "a machine principal never reaches them").
function machineCtxFor(org: SeededOrgWithOwner): TenantContext {
  return {
    userId: `api-key:${randomUUID()}`,
    organizationId: org.organizationId,
    organizationName: org.organizationName,
    role: "api_key",
  };
}

async function bellStateRows(organizationId: string, userId: string) {
  return db
    .select()
    .from(notificationBellState)
    .where(
      sql`${eq(notificationBellState.organizationId, organizationId)} and ${eq(notificationBellState.userId, userId)}`,
    );
}

async function readsRowsFor(notificationId: string) {
  return db
    .select()
    .from(notificationReads)
    .where(eq(notificationReads.notificationId, notificationId));
}

async function unreadFlagOf(ctx: TenantContext, notificationId: string): Promise<boolean> {
  const rows = await repoFor(ctx).listRecentWithReadState(LIST);
  const row = rows.find((candidate) => candidate.id === notificationId);
  if (!row) {
    throw new Error(`listRecentWithReadState returned no row for ${notificationId}`);
  }
  return row.unread;
}

describe("the read predicate: reads row exists OR created_at < read_before, in SQL, per viewer", () => {
  test("all four combinations of reads row and watermark resolve per D-5", async () => {
    const org = await seedOrg("predicate");
    const past = await seedNotification(db, {
      organizationId: org.organizationId,
      createdAt: minutesFromNow(-60),
    });
    const future = await seedNotification(db, {
      organizationId: org.organizationId,
      createdAt: minutesFromNow(5),
    });

    // Neither arm true: both rows unread.
    expect(await unreadFlagOf(org.ctx, past.id)).toBe(true);
    expect(await unreadFlagOf(org.ctx, future.id)).toBe(true);

    // Watermark arm only: the older row reads, the newer row survives it.
    await repoFor(org.ctx).markAllRead();
    expect(await unreadFlagOf(org.ctx, past.id)).toBe(false);
    expect(await unreadFlagOf(org.ctx, future.id)).toBe(true);

    // Reads-row arm only (the newer row is after the watermark).
    await repoFor(org.ctx).markRead(future.id);
    expect(await unreadFlagOf(org.ctx, future.id)).toBe(false);
  });

  test("a markRead after markAllRead writes one redundant reads row and the OR absorbs it", async () => {
    const org = await seedOrg("absorbed");
    const row = await seedNotification(db, {
      organizationId: org.organizationId,
      createdAt: minutesFromNow(-60),
    });

    await repoFor(org.ctx).markAllRead();
    await repoFor(org.ctx).markRead(row.id);

    expect(await readsRowsFor(row.id)).toHaveLength(1);
    expect(await unreadFlagOf(org.ctx, row.id)).toBe(false);
  });

  test("markRead is idempotent by primary key — twice writes one row", async () => {
    const org = await seedOrg("idempotent");
    const row = await seedNotification(db, {
      organizationId: org.organizationId,
      createdAt: minutesFromNow(-30),
    });

    await repoFor(org.ctx).markRead(row.id);
    await repoFor(org.ctx).markRead(row.id);

    expect(await readsRowsFor(row.id)).toHaveLength(1);
    expect(await unreadFlagOf(org.ctx, row.id)).toBe(false);
  });
});

describe("the badge is a different fact: created_at > opened_at, read state ignored", () => {
  test("a never-opened viewer counts everything, capped at ten (the teammate-joins case)", async () => {
    const org = await seedOrg("badge-cap");
    for (let i = 0; i < 12; i += 1) {
      await seedNotification(db, {
        organizationId: org.organizationId,
        createdAt: minutesFromNow(-120 + i),
      });
    }

    // openedAt is null — the org's whole recent record is "new" by construction (D1) —
    // and the count stops at ten because the display caps at 9+.
    expect(await repoFor(org.ctx).countNewerThanOpened()).toBe(10);
  });

  test("after a stamp only rows newer than opened_at count, and reading them does not clear the badge", async () => {
    const org = await seedOrg("badge-stamp");
    for (let i = 0; i < 3; i += 1) {
      await seedNotification(db, {
        organizationId: org.organizationId,
        createdAt: minutesFromNow(-60 + i),
      });
    }

    await repoFor(org.ctx).stampOpened();
    expect(await repoFor(org.ctx).countNewerThanOpened()).toBe(0);

    const arrival = await seedNotification(db, {
      organizationId: org.organizationId,
      createdAt: minutesFromNow(5),
    });
    expect(await repoFor(org.ctx).countNewerThanOpened()).toBe(1);

    // The two-tier model: marking the arrival read moves the dot fact, never the badge fact.
    await repoFor(org.ctx).markRead(arrival.id);
    expect(await repoFor(org.ctx).countNewerThanOpened()).toBe(1);
  });
});

describe("bell-state watermarks are monotonic and idempotent", () => {
  test("an out-of-order opened stamp can only clear more, never resurrect a badge (D6)", async () => {
    const org = await seedOrg("monotonic-opened");

    await repoFor(org.ctx).stampOpened();
    const [stamped] = await bellStateRows(org.organizationId, org.userId);
    expect(stamped?.openedAt).toBeInstanceOf(Date);

    // A racing tab already stamped a later instant; this tab's older stamp arrives after.
    const future = minutesFromNow(60);
    await db
      .update(notificationBellState)
      .set({ openedAt: future })
      .where(eq(notificationBellState.userId, org.userId));

    await repoFor(org.ctx).stampOpened();

    const [after] = await bellStateRows(org.organizationId, org.userId);
    expect(after?.openedAt?.getTime()).toBe(future.getTime());
  });

  test("read_before never regresses either, and stamping opened leaves it untouched", async () => {
    const org = await seedOrg("monotonic-read");

    await repoFor(org.ctx).markAllRead();
    const future = minutesFromNow(60);
    await db
      .update(notificationBellState)
      .set({ readBefore: future })
      .where(eq(notificationBellState.userId, org.userId));

    await repoFor(org.ctx).markAllRead();
    const [after] = await bellStateRows(org.organizationId, org.userId);
    expect(after?.readBefore?.getTime()).toBe(future.getTime());

    // The two facts stay separate: an opened stamp moves opened_at only.
    await repoFor(org.ctx).stampOpened();
    const [separate] = await bellStateRows(org.organizationId, org.userId);
    expect(separate?.readBefore?.getTime()).toBe(future.getTime());
  });

  test("a machine principal is refused for every bell-state write", async () => {
    const org = await seedOrg("machine");
    const row = await seedNotification(db, {
      organizationId: org.organizationId,
      createdAt: minutesFromNow(-10),
    });

    // The member control first: the same writes succeed for a person, so the refusals
    // below are about the principal, not about a stub that refuses everyone.
    await repoFor(org.ctx).stampOpened();
    expect(await bellStateRows(org.organizationId, org.userId)).toHaveLength(1);

    const machine = machineCtxFor(org);
    await expect(repoFor(machine).stampOpened()).rejects.toThrow();
    await expect(repoFor(machine).markAllRead()).rejects.toThrow();
    await expect(repoFor(machine).markRead(row.id)).rejects.toThrow();

    expect(await bellStateRows(org.organizationId, machine.userId)).toHaveLength(0);
    expect(
      (await readsRowsFor(row.id)).filter((read) => read.userId === machine.userId),
    ).toHaveLength(0);
  });
});

describe("cross-org and cross-user isolation on every bell read and write (D7)", () => {
  test("org B's rows are invisible to org A's list", async () => {
    const orgA = await seedOrg("isolation-a");
    const orgB = await seedOrg("isolation-b");
    const mine = await seedNotification(db, {
      organizationId: orgA.organizationId,
      createdAt: minutesFromNow(-10),
    });
    const theirs = await seedNotification(db, {
      organizationId: orgB.organizationId,
      createdAt: minutesFromNow(-5),
    });

    const listed = await repoFor(orgA.ctx).listRecentWithReadState(LIST);
    const ids = listed.map((row) => row.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
  });

  test("markRead with org B's notification id writes zero rows — the insert-from-select guard", async () => {
    const orgA = await seedOrg("guard-a");
    const orgB = await seedOrg("guard-b");
    const mine = await seedNotification(db, {
      organizationId: orgA.organizationId,
      createdAt: minutesFromNow(-10),
    });
    const theirs = await seedNotification(db, {
      organizationId: orgB.organizationId,
      createdAt: minutesFromNow(-10),
    });

    // The control: the same call against the caller's own row writes exactly one.
    await repoFor(orgA.ctx).markRead(mine.id);
    expect(await readsRowsFor(mine.id)).toHaveLength(1);

    await repoFor(orgA.ctx).markRead(theirs.id);
    expect(await readsRowsFor(theirs.id)).toHaveLength(0);
  });

  test("one member's reads never alter another member's flags", async () => {
    const org = await seedOrg("two-members");
    const teammateUser = await seedUser(db, {
      name: NAMES.userName("teammate"),
      email: NAMES.email("teammate"),
    });
    await seedMember(db, {
      organizationId: org.organizationId,
      userId: teammateUser.id,
      role: "member",
    });
    const teammateCtx = makeTenantContext({
      userId: teammateUser.id,
      organizationId: org.organizationId,
      organizationName: org.organizationName,
      role: "member",
    });

    const row = await seedNotification(db, {
      organizationId: org.organizationId,
      createdAt: minutesFromNow(-10),
    });

    await repoFor(org.ctx).markRead(row.id);

    expect(await unreadFlagOf(org.ctx, row.id)).toBe(false);
    expect(await unreadFlagOf(teammateCtx, row.id)).toBe(true);
  });
});
