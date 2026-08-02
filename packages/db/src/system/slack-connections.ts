import { asc, eq, inArray } from "drizzle-orm";

import type { ScopedDb } from "../repositories/types";
import { organization } from "../schema/auth";
import { slackConnections } from "../schema/slack-connections";

export async function existsAnyActiveSlackConnection(db: ScopedDb): Promise<boolean> {
  const [row] = await db
    .select({ id: slackConnections.id })
    .from(slackConnections)
    .where(eq(slackConnections.isActive, true))
    .limit(1);

  return row !== undefined;
}

export interface SlackDeliveryOrganization {
  readonly organizationId: string;

  readonly organizationName: string;
  readonly connectionId: string;

  // `null` since AD-4: an org mid-OAuth is active, has a token, and has no address. Widened
  // here but NOT on `DeliveryLane.channelId`, so postability narrows once at `isDeliveryTarget`.
  readonly channelId: string | null;
}

// Every organization with an ACTIVE Slack connection — the population the delivery tick
// quantifies over; no installation returns `[]`. Deliberately NOT filtered on
// `channel_id IS NOT NULL` (AD-4): "may we post?" belongs in the delivery guard, not in a SQL
// predicate every future query would have to remember to copy.
export async function listOrgsWithActiveSlackConnection(
  db: ScopedDb,
): Promise<SlackDeliveryOrganization[]> {
  const rows = await db
    .select({
      organizationId: slackConnections.organizationId,
      connectionId: slackConnections.id,
      channelId: slackConnections.channelId,
    })
    .from(slackConnections)
    .where(eq(slackConnections.isActive, true))
    .orderBy(asc(slackConnections.organizationId));

  if (rows.length === 0) {
    return [];
  }

  const orgIds = [...new Set(rows.map((row) => row.organizationId))];
  const orgRows = await db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .where(inArray(organization.id, orgIds));
  const orgNames = new Map(orgRows.map((row) => [row.id, row.name]));

  return rows.map((row) => {
    const organizationName = orgNames.get(row.organizationId);
    if (organizationName === undefined) {
      throw new Error(
        `listOrgsWithActiveSlackConnection: no organization row for connection ${row.connectionId}`,
      );
    }

    return {
      organizationId: row.organizationId,
      organizationName,
      connectionId: row.connectionId,
      channelId: row.channelId,
    };
  });
}
