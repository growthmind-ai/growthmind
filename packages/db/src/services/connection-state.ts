import type { ConnectionState, ConnectionSummary, TenantContext } from "@growthmind/shared";
import { and, desc, eq } from "drizzle-orm";

import { toConnectionSummary } from "../repositories/project-connections.repo";
import type { ScopedDb } from "../repositories/types";
import { projectConnections } from "../schema/project-connections";

export interface ConnectionActivity {
  hasCompletedPoll: boolean;

  hasEvents: boolean;
}

export function deriveConnectionState(
  connection: ConnectionSummary | null,
  activity: ConnectionActivity,
): ConnectionState {
  if (!connection) {
    return { status: "not_connected" };
  }

  if (!connection.isActive || connection.health === "disconnected") {
    return { status: "disconnected", connection };
  }

  if (connection.health === "validating") {
    return { status: "validating", connection };
  }

  if (connection.health === "failing") {
    return { status: "failing", connection };
  }

  if (!activity.hasCompletedPoll) {
    return { status: "connected_never_polled", connection };
  }

  return activity.hasEvents
    ? { status: "connected_receiving", connection }
    : { status: "connected_no_events_yet", connection };
}

export async function findLatestConnection(
  db: ScopedDb,
  ctx: TenantContext,
  projectId: string,
): Promise<ConnectionSummary | null> {
  const [row] = await db
    .select()
    .from(projectConnections)
    .where(
      and(
        eq(projectConnections.organizationId, ctx.organizationId),
        eq(projectConnections.projectId, projectId),
      ),
    )
    .orderBy(desc(projectConnections.isActive), desc(projectConnections.connectedAt))
    .limit(1);

  return row ? toConnectionSummary(row) : null;
}
