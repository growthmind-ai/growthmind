import { VERDICT_WINDOW_DAYS_DEFAULT } from "@growthmind/shared";
import { and, asc, eq, isNotNull, lte, sql } from "drizzle-orm";

import type { ScopedDb } from "../repositories/types";
import { organization } from "../schema/auth";
import { notificationSettings } from "../schema/notification-settings";
import { shippedChanges } from "../schema/shipped-changes";

export interface ScheduledShippedChange {
  readonly changeId: string;
  readonly organizationId: string;
  readonly organizationName: string;

  // Null once the project is deleted; the row outlives it so `abandoned` stays reachable
  // (tasks/o-053-report-shipped/resolutions.md R8).
  readonly projectId: string | null;
}

const SCHEDULED_COLUMNS = {
  changeId: shippedChanges.id,
  organizationId: shippedChanges.organizationId,
  organizationName: organization.name,
  projectId: shippedChanges.projectId,
};

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
): Promise<readonly ScheduledShippedChange[]> {
  return db
    .select(SCHEDULED_COLUMNS)
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
