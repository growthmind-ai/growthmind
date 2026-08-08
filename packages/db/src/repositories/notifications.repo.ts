import {
  memberUserId,
  NOTIFICATION_BADGE_COUNT_CAP,
  type NotificationSubjectKind,
  type NotificationType,
  type SlackReceiptFacts,
  type TenantContext,
} from "@growthmind/shared";
import { and, desc, eq, gte, inArray, notInArray, sql, type SQL } from "drizzle-orm";

import {
  notificationBellState,
  notificationReads,
  notifications,
  notificationSends,
} from "../schema/notifications";
import { scoped } from "./scope";
import type { ScopedExecutor } from "./types";

// The receipt shape is declared once, in shared, so the pure precedence rule and the row
// this repository hands out cannot come to disagree about what a receipt is.
export interface NotificationSendFacts extends SlackReceiptFacts {}

// `payload` stays `unknown` outward: a stored row can carry any shape ever written (D5),
// so the one tolerant parse happens in the consuming service, never on trust of the
// column's declared type.
export interface NotificationWithReadState {
  readonly id: string;
  readonly type: NotificationType;
  readonly subjectKind: NotificationSubjectKind;
  readonly subjectId: string;
  readonly actorUserId: string | null;
  readonly payload: unknown;
  readonly createdAt: Date;
  readonly unread: boolean;
  readonly sends: readonly NotificationSendFacts[];
}

export interface ListRecentOptions {
  readonly limit: number;
  readonly windowDays: number;

  // One computed value, passed into both the list and the badge count by the service, so
  // the two reads cannot come to filter different populations (ADD D-5b).
  readonly hiddenTypes?: readonly NotificationType[];
}

export interface BadgeCountOptions {
  readonly windowDays: number;
  readonly hiddenTypes: readonly NotificationType[];
}

export interface NotificationsRepo {
  // The read predicate — a reads row exists OR created_at < read_before — is computed in
  // this method's SQL and nowhere else (ADD D-5); `unread` carries it outward.
  listRecentWithReadState(
    options: ListRecentOptions,
  ): Promise<readonly NotificationWithReadState[]>;

  // The badge is deliberately a different fact: created_at at-or-after opened_at, ignoring
  // read state — at-or-after because the shared clock resolves to a finite tick, and an
  // arrival inside the stamp's own tick must light the badge rather than vanish. Capped by
  // subquery LIMIT 10 — display caps at 9+, so counting past ten is waste. It takes the
  // same window and hidden types the list does, so the two cannot count different
  // populations and offer a badge that opens onto nothing (ADD D-5).
  countNewerThanOpened(options: BadgeCountOptions): Promise<number>;

  stampOpened(): Promise<void>;

  markAllRead(): Promise<void>;

  // Reports whether the id names a notification this organization holds: the route turns
  // a false into a refusal, so a guessed id is answered the same way a deleted one is (D7).
  markRead(notificationId: string): Promise<boolean>;
}

const DAY_MS = 24 * 60 * 60 * 1_000;

function visibleTypes(hiddenTypes: readonly NotificationType[] | undefined): SQL | undefined {
  return hiddenTypes === undefined || hiddenTypes.length === 0
    ? undefined
    : notInArray(notifications.type, [...hiddenTypes]);
}

export function createNotificationsRepo(db: ScopedExecutor, ctx: TenantContext): NotificationsRepo {
  const s = scoped(db, ctx);

  // Per-person read state belongs to people (ADD §6): a key or a scheduled task has no
  // bell, and letting one through would stamp a synthetic id into a `user.id` column.
  function requirePerson(operation: string): string {
    const userId = memberUserId(ctx);

    if (userId === null) {
      throw new Error(
        `notifications.${operation}: bell state belongs to people, and this principal is a machine`,
      );
    }

    return userId;
  }

  async function sendsFor(
    notificationIds: readonly string[],
  ): Promise<ReadonlyMap<string, NotificationSendFacts[]>> {
    const byNotification = new Map<string, NotificationSendFacts[]>();

    if (notificationIds.length === 0) {
      return byNotification;
    }

    const rows = await db
      .select()
      .from(notificationSends)
      .where(
        s.owned(notificationSends, inArray(notificationSends.notificationId, [...notificationIds])),
      )
      .orderBy(notificationSends.createdAt);

    for (const row of rows) {
      const facts: NotificationSendFacts = {
        channel: row.channel,
        target: row.target,
        status: row.status,
        quietReason: row.quietReason,
        failureReason: row.failureReason,
        messageRef: row.messageRef,
        channelLabel: row.channelLabel,
        sentAt: row.sentAt,
        createdAt: row.createdAt,
      };

      const existing = byNotification.get(row.notificationId);
      if (existing) {
        existing.push(facts);
      } else {
        byNotification.set(row.notificationId, [facts]);
      }
    }

    return byNotification;
  }

  return {
    async listRecentWithReadState(
      options: ListRecentOptions,
    ): Promise<readonly NotificationWithReadState[]> {
      const since = new Date(Date.now() - options.windowDays * DAY_MS);

      // D-5, in one place: read iff a reads row exists OR created_at < read_before. The
      // watermark arm is coalesced because `created_at < null` is null, and a null OR
      // would surface as a null `unread` rather than a boolean.
      const rows = await db
        .select({
          id: notifications.id,
          type: notifications.type,
          subjectKind: notifications.subjectKind,
          subjectId: notifications.subjectId,
          actorUserId: notifications.actorUserId,
          payload: notifications.payload,
          createdAt: notifications.createdAt,
          unread: sql<boolean>`not (${notificationReads.notificationId} is not null or coalesce(${notifications.createdAt} < ${notificationBellState.readBefore}, false))`,
        })
        .from(notifications)
        .leftJoin(
          notificationReads,
          and(
            eq(notificationReads.notificationId, notifications.id),
            eq(notificationReads.userId, ctx.userId),
          ),
        )
        .leftJoin(
          notificationBellState,
          and(
            eq(notificationBellState.organizationId, notifications.organizationId),
            eq(notificationBellState.userId, ctx.userId),
          ),
        )
        .where(
          s.owned(
            notifications,
            gte(notifications.createdAt, since),
            visibleTypes(options.hiddenTypes),
          ),
        )
        .orderBy(desc(notifications.createdAt))
        .limit(options.limit);

      const sends = await sendsFor(rows.map((row) => row.id));

      return rows.map((row) => ({
        id: row.id,
        type: row.type,
        subjectKind: row.subjectKind,
        subjectId: row.subjectId,
        actorUserId: row.actorUserId,
        payload: row.payload,
        createdAt: row.createdAt,
        unread: row.unread,
        sends: sends.get(row.id) ?? [],
      }));
    },

    async countNewerThanOpened(options: BadgeCountOptions): Promise<number> {
      const since = new Date(Date.now() - options.windowDays * DAY_MS);

      // A never-opened viewer counts everything inside the window (the teammate-joins
      // case, D1): the coalesced -infinity is that arm. The watermark is compared in SQL
      // rather than read out and passed back, because a JS Date round-trip loses the
      // microseconds and can round the watermark past a same-millisecond insert. The
      // window and the mute filter are the list's own, so the badge can never count a row
      // the popover will not show.
      const capped = db
        .select({ one: sql`1` })
        .from(notifications)
        .leftJoin(
          notificationBellState,
          and(
            eq(notificationBellState.organizationId, notifications.organizationId),
            eq(notificationBellState.userId, ctx.userId),
          ),
        )
        .where(
          s.owned(
            notifications,
            gte(notifications.createdAt, since),
            visibleTypes(options.hiddenTypes),
            gte(
              notifications.createdAt,
              sql`coalesce(${notificationBellState.openedAt}, '-infinity'::timestamptz)`,
            ),
          ),
        )
        .limit(NOTIFICATION_BADGE_COUNT_CAP)
        .as("capped");

      const [row] = await db.select({ count: sql<number>`cast(count(*) as int)` }).from(capped);

      return row?.count ?? 0;
    },

    async stampOpened(): Promise<void> {
      const userId = requirePerson("stampOpened");

      // greatest(coalesce(old, -infinity), new): two racing tabs or an out-of-order close
      // stamp can only clear more, never resurrect a badge (D6). read_before is untouched.
      // now(), not new Date(): this value is compared against created_at, which the
      // database stamps, and a comparison needs one clock (ADD §4.5).
      await db
        .insert(notificationBellState)
        .values({ ...s.stamp, userId, openedAt: sql`now()` })
        .onConflictDoUpdate({
          target: [notificationBellState.organizationId, notificationBellState.userId],
          set: {
            openedAt: sql`greatest(coalesce(${notificationBellState.openedAt}, '-infinity'::timestamptz), excluded.opened_at)`,
          },
        });
    },

    async markAllRead(): Promise<void> {
      const userId = requirePerson("markAllRead");

      await db
        .insert(notificationBellState)
        .values({ ...s.stamp, userId, readBefore: sql`now()` })
        .onConflictDoUpdate({
          target: [notificationBellState.organizationId, notificationBellState.userId],
          set: {
            readBefore: sql`greatest(coalesce(${notificationBellState.readBefore}, '-infinity'::timestamptz), excluded.read_before)`,
          },
        });
    },

    async markRead(notificationId: string): Promise<boolean> {
      const userId = requirePerson("markRead");

      // One statement, insert-from-select: the org filter sits inside the write, so a
      // cross-org id selects nothing and writes zero rows (D7), and the PK conflict makes
      // a second press free. Raw SQL because the query builder cannot put a conflict
      // clause on an insert-from-select; the column names are the schema's own.
      await db.execute(sql`
        insert into ${notificationReads} ("organization_id", "notification_id", "user_id")
        select ${notifications.organizationId}, ${notifications.id}, ${userId}
        from ${notifications}
        where ${s.org(notifications)} and ${eq(notifications.id, notificationId)}
        on conflict ("notification_id", "user_id") do nothing
      `);

      // Not the insert's row count: a second press writes nothing and is still a read of a
      // row this org holds. Visibility is the question the caller is asking.
      const [visible] = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(s.owned(notifications, eq(notifications.id, notificationId)))
        .limit(1);

      return visible !== undefined;
    },
  };
}
