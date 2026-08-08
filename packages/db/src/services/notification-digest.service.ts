import { digestDayMatches } from "@growthmind/core";
import { buildDigestDedupKey, type TenantContext, type Weekday } from "@growthmind/shared";
import { and, desc, eq, exists, gt, inArray, lte, sql } from "drizzle-orm";

import { emitNotification } from "../notifications/emit";
import { scoped } from "../repositories/scope";
import type { ScopedDb, ScopedExecutor } from "../repositories/types";
import { notificationSettings } from "../schema/notification-settings";
import { notifications, notificationSends } from "../schema/notifications";
import { listOrgsWithActiveSlackConnection } from "../system/slack-connections";

export interface DigestDueOrganization {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly digestDay: Weekday;
}

// Every org with Slack connected, LEFT JOINed to its settings row. The outer join is
// load-bearing and one keyword from being wrong: absence is the default, so an INNER JOIN
// would silently exclude every customer who has never opened the card — the exact
// population the control would then be lying to.
export async function listOrganizationsDueForDigest(
  db: ScopedDb,
  at: Date,
): Promise<readonly DigestDueOrganization[]> {
  const orgs = await listOrgsWithActiveSlackConnection(db);

  if (orgs.length === 0) {
    return [];
  }

  const settingsRows = await db
    .select({
      organizationId: notificationSettings.organizationId,
      digestCadence: notificationSettings.digestCadence,
      digestDay: notificationSettings.digestDay,
    })
    .from(notificationSettings)
    .where(
      inArray(
        notificationSettings.organizationId,
        orgs.map((org) => org.organizationId),
      ),
    );
  const settingsByOrg = new Map(settingsRows.map((row) => [row.organizationId, row]));

  const due: DigestDueOrganization[] = [];
  for (const org of orgs) {
    const settings = settingsByOrg.get(org.organizationId);

    // No row means the documented default (D-6): weekly, on Monday.
    const cadence = settings?.digestCadence ?? "weekly";
    const day = settings?.digestDay ?? "monday";

    if (cadence === "weekly" && digestDayMatches(day, at)) {
      due.push({
        organizationId: org.organizationId,
        organizationName: org.organizationName,
        digestDay: day,
      });
    }
  }

  return due;
}

export interface DigestGatherInput {
  readonly windowStart: Date;
  readonly windowEnd: Date;

  readonly limit: number;
}

export interface DigestGather {
  // Capped at `limit`; the payload freezes ids, never text.
  readonly notificationIds: readonly string[];

  // Of the whole window, so the summary's denominator describes the week rather than
  // whatever the list happened to hold.
  readonly totalCount: number;
}

// Exactly the population `quiet: digest` was minted for. Anything actionable either posted
// or is unsettled, and belongs to the rescue rather than to a summary. The window is
// exclusive at its start so a second summary never repeats what the first one carried.
export async function gatherDigestNotifications(
  db: ScopedExecutor,
  ctx: TenantContext,
  input: DigestGatherInput,
): Promise<DigestGather> {
  const s = scoped(db, ctx);

  const deferred = exists(
    db
      .select({ one: sql`1` })
      .from(notificationSends)
      .where(
        and(
          eq(notificationSends.notificationId, notifications.id),
          eq(notificationSends.channel, "slack"),
          eq(notificationSends.status, "quiet"),
          eq(notificationSends.quietReason, "digest"),
        ),
      ),
  );

  const inWindow = s.owned(
    notifications,
    gt(notifications.createdAt, input.windowStart),
    lte(notifications.createdAt, input.windowEnd),
    deferred,
  );

  const [counted] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(notifications)
    .where(inWindow);

  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(inWindow)
    .orderBy(notifications.createdAt)
    .limit(input.limit);

  return {
    notificationIds: rows.map((row) => row.id),
    totalCount: counted?.total ?? 0,
  };
}

// The org's most recent summary, which is where the next window starts (D-8): a fixed
// lookback would double-report the overlap when an org moves its day.
export async function findLastDigestAt(
  db: ScopedExecutor,
  ctx: TenantContext,
): Promise<Date | null> {
  const s = scoped(db, ctx);

  const [row] = await db
    .select({ createdAt: notifications.createdAt })
    .from(notifications)
    .where(s.owned(notifications, eq(notifications.type, "digest")))
    .orderBy(desc(notifications.createdAt))
    .limit(1);

  return row?.createdAt ?? null;
}

export interface EmitDigestSummaryInput {
  readonly notificationIds: readonly string[];
  readonly totalCount: number;
  readonly windowEnd: Date;
}

// The one digest emitter: the ordinary owed arm, so the Slack leg is the dispatch spine
// and the summary adds no Slack call site (D-8). Callers skip an empty gather entirely —
// an empty week leaves no row, not a row saying nothing happened.
export async function emitDigestSummary(
  db: ScopedExecutor,
  ctx: TenantContext,
  input: EmitDigestSummaryInput,
): Promise<void> {
  await emitNotification(db, ctx.organizationId, {
    type: "digest",
    subjectKind: "organization",
    subjectId: ctx.organizationId,
    actorUserId: null,
    payload: {
      type: "digest",
      v: 1,
      notificationIds: [...input.notificationIds],
      totalCount: input.totalCount,
    },
    dedupKey: buildDigestDedupKey(ctx.organizationId, input.windowEnd.toISOString()),
    slack: { kind: "owed" },
  });
}
