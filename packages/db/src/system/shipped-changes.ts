import { VERDICT_WINDOW_DAYS_DEFAULT } from "@growthmind/shared";
import { and, asc, eq, isNotNull, lte, sql } from "drizzle-orm";

import type { ScopedDb } from "../repositories/types";
import { organization } from "../schema/auth";
import { notificationSettings } from "../schema/notification-settings";
import { notifications, notificationSends } from "../schema/notifications";
import { shippedChanges } from "../schema/shipped-changes";

export interface ScheduledShippedChange {
  readonly changeId: string;
  readonly organizationId: string;
  readonly organizationName: string;

  // Null once the project is deleted: a cascade would delete the very row whose terminal state
  // records that the project is gone, and `restrict` would stop it ever going.
  readonly projectId: string | null;
}

export interface LapsedShippedChange extends ScheduledShippedChange {
  // Whether the readout actually reached the org's channel. An org with no Slack connection
  // gets a quiet receipt, so without this the lapse pass would record "no verdict given"
  // against a founder who was never asked.
  readonly readoutDelivered: boolean;
}

const SCHEDULED_COLUMNS = {
  changeId: shippedChanges.id,
  organizationId: shippedChanges.organizationId,
  organizationName: organization.name,
  projectId: shippedChanges.projectId,
};

// Only `sent` counts. A quiet receipt means there was no channel to ask in, and a failed one
// means the ask never landed; neither is a question the founder declined to answer. The join
// carries the org as well as the notification id because nothing at the schema level ties a send
// row to its notification's tenant.
const READOUT_WAS_DELIVERED = sql<boolean>`exists (
  select 1
  from ${notifications}
  join ${notificationSends}
    on ${notificationSends.notificationId} = ${notifications.id}
    and ${notificationSends.organizationId} = ${notifications.organizationId}
  where ${notifications.organizationId} = ${shippedChanges.organizationId}
    and ${notifications.subjectId} = ${shippedChanges.id}
    and ${notifications.type} = 'change_readout'
    and ${notificationSends.status} = 'sent'
)`;

export async function listDueShippedReadouts(
  db: ScopedDb,
  at: Date,
): Promise<readonly ScheduledShippedChange[]> {
  return db
    .select(SCHEDULED_COLUMNS)
    .from(shippedChanges)
    .innerJoin(organization, eq(organization.id, shippedChanges.organizationId))
    .where(and(eq(shippedChanges.state, "reported"), lte(shippedChanges.readoutDueAt, at)))
    .orderBy(asc(shippedChanges.readoutDueAt), asc(shippedChanges.id));
}

// The window is per row, from that row's own `read_out_at`, and the join is OUTER for the
// reason the digest's is: absence is the default, so an inner join would silently exempt
// every organization that has never configured anything from ever lapsing.
export async function listLapsedShippedChanges(
  db: ScopedDb,
  at: Date,
): Promise<readonly LapsedShippedChange[]> {
  return db
    .select({ ...SCHEDULED_COLUMNS, readoutDelivered: READOUT_WAS_DELIVERED })
    .from(shippedChanges)
    .innerJoin(organization, eq(organization.id, shippedChanges.organizationId))
    .leftJoin(
      notificationSettings,
      eq(notificationSettings.organizationId, shippedChanges.organizationId),
    )
    .where(
      and(
        eq(shippedChanges.state, "read_out"),
        isNotNull(shippedChanges.readOutAt),
        sql`${shippedChanges.readOutAt} + (coalesce(${notificationSettings.verdictWindowDays}, ${VERDICT_WINDOW_DAYS_DEFAULT}) * interval '1 day') <= ${at}::timestamptz`,
      ),
    )
    .orderBy(asc(shippedChanges.readOutAt), asc(shippedChanges.id));
}
