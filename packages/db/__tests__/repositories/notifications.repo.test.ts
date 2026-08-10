// The bell's read model (ADD D-5): the read predicate has exactly one home — the SQL of
// listRecentWithReadState — the badge is a deliberately different fact, and both watermarks
// only ever move forward. RED in Wave 0 against the throwing repo stubs.
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import {
  NOTIFICATION_CLASS_BY_TYPE,
  NOTIFICATION_LIST_LIMIT,
  NOTIFICATION_SEND_NO_TARGET,
  NOTIFICATION_TYPES,
  NOTIFICATION_WINDOW_DAYS,
  SLACK_INTERACTION_ACTOR,
  SLACK_INTERACTION_ROLE,
  type MutableNotificationClass,
  type NotificationSubjectKind,
  type NotificationType,
  type TenantContext,
} from "@growthmind/shared";

import {
  loadUnderConstruction,
  underConstructionSpecifier,
} from "../../../shared/__tests__/onboarding/module-under-construction";
import { inTransaction } from "../../src/repositories/crud";
import { createNotificationMutesRepo } from "../../src/repositories/notification-mutes.repo";
import {
  createNotificationsRepo,
  type NotificationWithReadState,
} from "../../src/repositories/notifications.repo";
import {
  notificationBellState,
  notificationReads,
  notifications,
  notificationSends,
} from "../../src/schema/notifications";
import {
  createTestDb,
  laneNames,
  makeTenantContext,
  seedMember,
  seedNotification,
  seedNotificationSend,
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
    expect(
      await repoFor(org.ctx).countNewerThanOpened({
        windowDays: NOTIFICATION_WINDOW_DAYS,
        hiddenTypes: [],
      }),
    ).toBe(10);
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
    expect(
      await repoFor(org.ctx).countNewerThanOpened({
        windowDays: NOTIFICATION_WINDOW_DAYS,
        hiddenTypes: [],
      }),
    ).toBe(0);

    const arrival = await seedNotification(db, {
      organizationId: org.organizationId,
      createdAt: minutesFromNow(5),
    });
    expect(
      await repoFor(org.ctx).countNewerThanOpened({
        windowDays: NOTIFICATION_WINDOW_DAYS,
        hiddenTypes: [],
      }),
    ).toBe(1);

    // The two-tier model: marking the arrival read moves the dot fact, never the badge fact.
    await repoFor(org.ctx).markRead(arrival.id);
    expect(
      await repoFor(org.ctx).countNewerThanOpened({
        windowDays: NOTIFICATION_WINDOW_DAYS,
        hiddenTypes: [],
      }),
    ).toBe(1);
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

// O-051 job 2 (ADD D-5b): the mute filter is one computed argument passed into BOTH repo
// reads, so the badge and the list cannot drift. These mirrors type the widened reads the
// wave will ship; today the extra argument is ignored, which is the red.
type MutedListRead = (options: {
  readonly limit: number;
  readonly windowDays: number;
  readonly hiddenTypes: readonly NotificationType[];
}) => Promise<readonly NotificationWithReadState[]>;

type MutedBadgeCount = (options: {
  readonly windowDays: number;
  readonly hiddenTypes: readonly NotificationType[];
}) => Promise<number>;

// The service's documented derivation (mute rows → class map → type list), mirrored here
// because the repo deliberately takes the expansion rather than the mute rows.
function hiddenTypesOf(muted: readonly MutableNotificationClass[]): readonly NotificationType[] {
  const hidden: readonly string[] = muted;
  return NOTIFICATION_TYPES.filter((type) => hidden.includes(NOTIFICATION_CLASS_BY_TYPE[type]));
}

describe("muting a class hides its rows for that viewer only, and changes nothing that is recorded", () => {
  test("a work mute empties one member's list while the teammate and the record keep every row", async () => {
    const org = await seedOrg("mute-viewer");
    const teammateUser = await seedUser(db, {
      name: NAMES.userName("mute-mate"),
      email: NAMES.email("mute-mate"),
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

    const work = await seedNotification(db, {
      organizationId: org.organizationId,
      type: "finding_delivered",
      subjectKind: "finding",
      createdAt: minutesFromNow(-10),
    });
    await seedNotificationSend(db, {
      organizationId: org.organizationId,
      notificationId: work.id,
      status: "sent",
      sentAt: minutesFromNow(-9),
    });
    const actNow = await seedNotification(db, {
      organizationId: org.organizationId,
      type: "keys_revoked",
      createdAt: minutesFromNow(-8),
    });
    await seedNotificationSend(db, {
      organizationId: org.organizationId,
      notificationId: actNow.id,
      status: "quiet",
      quietReason: "no_channel",
      target: "none",
    });

    const recordedBefore = {
      rows: (
        await db
          .select({ id: notifications.id })
          .from(notifications)
          .where(eq(notifications.organizationId, org.organizationId))
      ).length,
      sends: (
        await db
          .select({ id: notificationSends.id })
          .from(notificationSends)
          .where(eq(notificationSends.organizationId, org.organizationId))
      ).length,
    };

    await createNotificationMutesRepo(db, org.ctx).mute("work");
    expect(await createNotificationMutesRepo(db, org.ctx).listMutedClasses()).toEqual(["work"]);
    expect(await createNotificationMutesRepo(db, teammateCtx).listMutedClasses()).toEqual([]);

    const listForViewer: MutedListRead = (options) =>
      repoFor(org.ctx).listRecentWithReadState(options);
    const listForTeammate: MutedListRead = (options) =>
      repoFor(teammateCtx).listRecentWithReadState(options);

    const mutedRows = await listForViewer({
      limit: NOTIFICATION_LIST_LIMIT,
      windowDays: NOTIFICATION_WINDOW_DAYS,
      hiddenTypes: hiddenTypesOf(["work"]),
    });
    expect(mutedRows.map((row) => row.id)).toEqual([actNow.id]);

    const teammateRows = await listForTeammate({
      limit: NOTIFICATION_LIST_LIMIT,
      windowDays: NOTIFICATION_WINDOW_DAYS,
      hiddenTypes: hiddenTypesOf([]),
    });
    expect(teammateRows.map((row) => row.id).toSorted()).toEqual([work.id, actNow.id].toSorted());

    // A mute changes one person's bell and nothing that is recorded (AC-21): the same
    // rows and the same receipts stand after as before.
    const recordedAfter = {
      rows: (
        await db
          .select({ id: notifications.id })
          .from(notifications)
          .where(eq(notifications.organizationId, org.organizationId))
      ).length,
      sends: (
        await db
          .select({ id: notificationSends.id })
          .from(notificationSends)
          .where(eq(notificationSends.organizationId, org.organizationId))
      ).length,
    };
    expect(recordedAfter).toEqual(recordedBefore);
  });
});

describe("the badge counts the same population the list shows", () => {
  test("the count applies the mute filter and the thirty-day floor exactly as the list does", async () => {
    const org = await seedOrg("badge-population");

    const work = await seedNotification(db, {
      organizationId: org.organizationId,
      type: "finding_delivered",
      subjectKind: "finding",
      createdAt: minutesFromNow(-10),
    });
    const actNow = await seedNotification(db, {
      organizationId: org.organizationId,
      type: "keys_revoked",
      createdAt: minutesFromNow(-5),
    });
    const beyondWindow = await seedNotification(db, {
      organizationId: org.organizationId,
      type: "keys_revoked",
      createdAt: new Date(Date.now() - (NOTIFICATION_WINDOW_DAYS + 5) * 24 * 60 * 60 * 1_000),
    });

    const list: MutedListRead = (options) => repoFor(org.ctx).listRecentWithReadState(options);
    const count: MutedBadgeCount = (options) => repoFor(org.ctx).countNewerThanOpened(options);

    // The window floor, both reads, no mute: the too-old row appears in neither.
    const unmutedRows = await list({
      limit: NOTIFICATION_LIST_LIMIT,
      windowDays: NOTIFICATION_WINDOW_DAYS,
      hiddenTypes: hiddenTypesOf([]),
    });
    expect(unmutedRows.map((row) => row.id)).not.toContain(beyondWindow.id);
    expect(
      await count({ windowDays: NOTIFICATION_WINDOW_DAYS, hiddenTypes: hiddenTypesOf([]) }),
    ).toBe(2);

    // The mute, both reads: what the badge counts is what the popover will show.
    const hidden = hiddenTypesOf(["work"]);
    const mutedRows = await list({
      limit: NOTIFICATION_LIST_LIMIT,
      windowDays: NOTIFICATION_WINDOW_DAYS,
      hiddenTypes: hidden,
    });
    expect(mutedRows.map((row) => row.id)).toEqual([actNow.id]);
    expect(mutedRows.map((row) => row.id)).not.toContain(work.id);
    expect(await count({ windowDays: NOTIFICATION_WINDOW_DAYS, hiddenTypes: hidden })).toBe(
      mutedRows.length,
    );
  });
});

describe("the watermarks are written by the database clock", () => {
  // Inside a transaction, Postgres freezes now() at the transaction's start while the
  // process clock keeps moving — so a watermark written with new Date() lands measurably
  // after the frozen instant, and one written with now() lands exactly on it. Real DB
  // time, no mocked clock (AC-10 / ADD §4.5 C-1).
  test("stampOpened and markAllRead store the transaction's own now(), not the process clock", async () => {
    const org = await seedOrg("db-clock");

    await inTransaction(db, async (tx) => {
      const result = (await (
        tx as unknown as { execute(q: unknown): Promise<{ rows: unknown[] }> }
      ).execute(sql`select now() as tx_now`)) as { rows: { tx_now: unknown }[] };
      const raw = result.rows[0]?.tx_now;
      const txNow = raw instanceof Date ? raw : new Date(String(raw));

      await Bun.sleep(40);

      const repo = createNotificationsRepo(tx, org.ctx);
      await repo.stampOpened();
      await repo.markAllRead();

      // The union type synthesizes select signatures that reject some chains; the runtime
      // handle is the same pglite database, so the read is cast to it.
      const [state] = await (tx as unknown as TestDb)
        .select()
        .from(notificationBellState)
        .where(eq(notificationBellState.userId, org.userId));
      if (!state?.openedAt || !state.readBefore) {
        throw new Error("the watermark writes left no bell-state row");
      }

      expect(Math.abs(state.openedAt.getTime() - txNow.getTime())).toBeLessThanOrEqual(2);
      expect(Math.abs(state.readBefore.getTime() - txNow.getTime())).toBeLessThanOrEqual(2);
    });

    // The pairing AC-10 names: a stamp followed immediately by a real insert leaves the
    // new notification unread and badge-counted, on shared DB time.
    await repoFor(org.ctx).stampOpened();
    const fresh = await seedNotification(db, { organizationId: org.organizationId });
    expect(
      await repoFor(org.ctx).countNewerThanOpened({
        windowDays: NOTIFICATION_WINDOW_DAYS,
        hiddenTypes: [],
      }),
    ).toBeGreaterThanOrEqual(1);
    expect(await unreadFlagOf(org.ctx, fresh.id)).toBe(true);
  });
});

// O-053 ADD Decision 5d: a Slack interactivity payload carries only (channel, message), so
// that pair is the ONLY source of org identity for a button press — which is why the index
// serving it is globally unique rather than org-scoped. RED in Wave 0: neither the export
// nor the index exists.
const INTERACTION_OWNER =
  "O-053 (packages/db/src/repositories/notifications.repo.ts resolveNotificationForInteraction, ADD Decision 5d)";

interface NotificationInteractionPrincipal {
  readonly context: TenantContext;
  readonly notificationId: string;
  readonly subjectKind: NotificationSubjectKind;
  readonly subjectId: string;
}

type ResolveNotificationForInteraction = (
  db: TestDb,
  args: { readonly channelId: string; readonly messageRef: string },
) => Promise<NotificationInteractionPrincipal | null>;

const loadResolveForInteraction = (): Promise<ResolveNotificationForInteraction> =>
  loadUnderConstruction<ResolveNotificationForInteraction>({
    modulePath: underConstructionSpecifier("packages/db/src/repositories/notifications.repo"),
    exportName: "resolveNotificationForInteraction",
    ownedBy: INTERACTION_OWNER,
  });

describe("a posted message routes a button press back to its organization and nowhere else", () => {
  const CHANNEL_A = "C0SHIPPEDA";
  const CHANNEL_B = "C0SHIPPEDB";
  const REF_A = "1786000000.111111";
  const REF_B = "1786000000.222222";

  // The index this suite asserts is globally unique, and the whole file shares one database,
  // so a pair may be written by exactly one test. Reusing (CHANNEL_A, REF_A) below would be
  // the suite writing the ambiguity the index exists to forbid.
  const CHANNEL_C = "C0SHIPPEDC";
  const CHANNEL_D = "C0SHIPPEDD";
  const REF_C = "1786000000.333333";
  const REF_D = "1786000000.444444";

  async function seedPostedNotification(params: {
    readonly organizationId: string;
    readonly channelId: string;
    readonly messageRef: string;
    readonly subjectId: string;
  }) {
    const row = await seedNotification(db, {
      organizationId: params.organizationId,
      subjectKind: "shipped_change",
      subjectId: params.subjectId,
      createdAt: minutesFromNow(-5),
    });
    await seedNotificationSend(db, {
      organizationId: params.organizationId,
      notificationId: row.id,
      status: "sent",
      target: params.channelId,
      messageRef: params.messageRef,
      sentAt: minutesFromNow(-5),
    });
    return row;
  }

  test("each pair resolves to its own organization's context, and a crossed pair resolves to nothing", async () => {
    const orgA = await seedOrg("interaction-a");
    const orgB = await seedOrg("interaction-b");
    const changeA = randomUUID();
    const changeB = randomUUID();

    const postedA = await seedPostedNotification({
      organizationId: orgA.organizationId,
      channelId: CHANNEL_A,
      messageRef: REF_A,
      subjectId: changeA,
    });
    const postedB = await seedPostedNotification({
      organizationId: orgB.organizationId,
      channelId: CHANNEL_B,
      messageRef: REF_B,
      subjectId: changeB,
    });

    const resolve = await loadResolveForInteraction();

    const fromA = await resolve(db, { channelId: CHANNEL_A, messageRef: REF_A });
    expect(fromA?.context.organizationId).toBe(orgA.organizationId);
    expect(fromA?.context.organizationName).toBe(orgA.organizationName);
    expect(fromA?.context.userId).toBe(SLACK_INTERACTION_ACTOR);
    expect(fromA?.context.role).toBe(SLACK_INTERACTION_ROLE);
    expect(fromA?.notificationId).toBe(postedA.id);
    expect(fromA?.subjectKind).toBe("shipped_change");
    expect(fromA?.subjectId).toBe(changeA);

    const fromB = await resolve(db, { channelId: CHANNEL_B, messageRef: REF_B });
    expect(fromB?.context.organizationId).toBe(orgB.organizationId);
    expect(fromB?.notificationId).toBe(postedB.id);
    expect(fromB?.subjectId).toBe(changeB);

    // One org's channel under the other org's message timestamp is not a row anybody wrote.
    expect(await resolve(db, { channelId: CHANNEL_A, messageRef: REF_B })).toBeNull();
    expect(await resolve(db, { channelId: CHANNEL_B, messageRef: REF_A })).toBeNull();
  });

  test("an unknown pair resolves to nothing rather than to somebody's organization", async () => {
    const org = await seedOrg("interaction-unknown");
    await seedPostedNotification({
      organizationId: org.organizationId,
      channelId: CHANNEL_C,
      messageRef: REF_C,
      subjectId: randomUUID(),
    });

    const resolve = await loadResolveForInteraction();

    // The control beside the null: the same call against a pair we did write resolves, so
    // the null below is about the unknown pair and not about a stub returning null.
    expect(await resolve(db, { channelId: CHANNEL_C, messageRef: REF_C })).not.toBeNull();
    expect(
      await resolve(db, { channelId: "C0NOBODY", messageRef: "1786000000.999999" }),
    ).toBeNull();
    expect(await resolve(db, { channelId: CHANNEL_C, messageRef: "" })).toBeNull();
  });

  test("the channel and message index refuses a second send row for one posted message and exempts a null message", async () => {
    const org = await seedOrg("interaction-index");
    const posted = await seedNotification(db, {
      organizationId: org.organizationId,
      subjectKind: "shipped_change",
      createdAt: minutesFromNow(-5),
    });
    const other = await seedNotification(db, {
      organizationId: org.organizationId,
      subjectKind: "shipped_change",
      createdAt: minutesFromNow(-4),
    });

    await seedNotificationSend(db, {
      organizationId: org.organizationId,
      notificationId: posted.id,
      status: "sent",
      target: CHANNEL_D,
      messageRef: REF_D,
      sentAt: minutesFromNow(-5),
    });

    // A second notification claiming the same posted message would make the press ambiguous,
    // and the resolve above reads one row by that pair.
    await expect(
      seedNotificationSend(db, {
        organizationId: org.organizationId,
        notificationId: other.id,
        status: "sent",
        target: CHANNEL_D,
        messageRef: REF_D,
        sentAt: minutesFromNow(-4),
      }),
    ).rejects.toThrow();

    // The exemption: a quiet receipt has no message to be ambiguous about, and every org
    // with no channel writes one against the same target.
    const quietA = await seedNotification(db, { organizationId: org.organizationId });
    const quietB = await seedNotification(db, { organizationId: org.organizationId });
    for (const notificationId of [quietA.id, quietB.id]) {
      await seedNotificationSend(db, {
        organizationId: org.organizationId,
        notificationId,
        status: "quiet",
        quietReason: "no_channel",
        target: NOTIFICATION_SEND_NO_TARGET,
        messageRef: null,
      });
    }

    const quietRows = await db
      .select({ id: notificationSends.id })
      .from(notificationSends)
      .where(
        sql`${eq(notificationSends.organizationId, org.organizationId)} and ${eq(notificationSends.target, NOTIFICATION_SEND_NO_TARGET)}`,
      );
    expect(quietRows).toHaveLength(2);
  });
});

describe("records everything survives both display caps", () => {
  test("the snapshot caps at twenty rows and thirty days while a direct read returns every row and every receipt", async () => {
    const org = await seedOrg("record-caps");

    const seeded: string[] = [];
    for (let index = 0; index < 25; index += 1) {
      const row = await seedNotification(db, {
        organizationId: org.organizationId,
        type: index % 2 === 0 ? "finding_delivered" : "keys_revoked",
        subjectKind: index % 2 === 0 ? "finding" : "agent_key",
        createdAt: minutesFromNow(-(index + 1)),
      });
      seeded.push(row.id);
    }
    for (let index = 0; index < 5; index += 1) {
      const row = await seedNotification(db, {
        organizationId: org.organizationId,
        type: "keys_revoked",
        createdAt: new Date(
          Date.now() - (NOTIFICATION_WINDOW_DAYS + 3 + index) * 24 * 60 * 60 * 1_000,
        ),
      });
      seeded.push(row.id);
    }
    for (const notificationId of seeded) {
      await seedNotificationSend(db, {
        organizationId: org.organizationId,
        notificationId,
        status: "quiet",
        quietReason: "no_channel",
        target: "none",
      });
    }

    const list: MutedListRead = (options) => repoFor(org.ctx).listRecentWithReadState(options);
    const snapshot = await list({
      limit: NOTIFICATION_LIST_LIMIT,
      windowDays: NOTIFICATION_WINDOW_DAYS,
      hiddenTypes: hiddenTypesOf([]),
    });

    expect(snapshot).toHaveLength(NOTIFICATION_LIST_LIMIT);
    const windowFloor = Date.now() - NOTIFICATION_WINDOW_DAYS * 24 * 60 * 60 * 1_000;
    for (const row of snapshot) {
      expect(row.createdAt.getTime()).toBeGreaterThanOrEqual(windowFloor);
    }

    // The display caps cap the display. The record keeps all thirty rows and all thirty
    // receipts (AC-25, FR-14 req 1).
    const storedRows = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(eq(notifications.organizationId, org.organizationId));
    expect(storedRows.map((row) => row.id).toSorted()).toEqual([...seeded].toSorted());

    const storedSends = await db
      .select({ id: notificationSends.id })
      .from(notificationSends)
      .where(eq(notificationSends.organizationId, org.organizationId));
    expect(storedSends).toHaveLength(seeded.length);
  });
});
