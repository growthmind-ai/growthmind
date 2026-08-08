import type { TenantContext } from "@growthmind/shared";
import { and, eq, gte, notExists, sql } from "drizzle-orm";

import { scoped } from "../repositories/scope";
import type { ScopedExecutor } from "../repositories/types";
import { notifications, notificationSends } from "../schema/notifications";

export interface UnsettledNotificationsInput {
  // The floor the bell already applies: a notification it will never show is not worth
  // posting to Slack.
  readonly since: Date;

  // A `pending` row claimed after this instant is in flight, not stranded.
  readonly staleClaimsBefore: Date;
}

// The inverse of settled, not the `quiet: no_channel` literal — the commonest way a broken
// connection strands a notification is a `failed` receipt whose credential could not be
// opened, and a sweep keyed on the literal cannot see it. Settled is: any `sent` row, or a
// `quiet` row whose reason is `digest`, which the summary owns. The sweep is deliberately
// blind to failure codes: it enumerates, and the dispatch claim decides.
export async function listUnsettledNotificationIds(
  db: ScopedExecutor,
  ctx: TenantContext,
  input: UnsettledNotificationsInput,
): Promise<readonly string[]> {
  const s = scoped(db, ctx);

  const settling = db
    .select({ one: sql`1` })
    .from(notificationSends)
    .where(
      and(
        eq(notificationSends.notificationId, notifications.id),
        eq(notificationSends.channel, "slack"),
        sql`(${eq(notificationSends.status, "sent")} or (${eq(
          notificationSends.status,
          "quiet",
        )} and ${eq(notificationSends.quietReason, "digest")}) or (${eq(
          notificationSends.status,
          "pending",
        )} and ${gte(notificationSends.claimedAt, input.staleClaimsBefore)}))`,
      ),
    );

  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(s.owned(notifications, gte(notifications.createdAt, input.since), notExists(settling)))
    .orderBy(notifications.createdAt);

  return rows.map((row) => row.id);
}
