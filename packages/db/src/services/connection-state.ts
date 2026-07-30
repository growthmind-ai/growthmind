// The ONE derivation of the seven connection states (O-003, Design Input for
// O-008), plus the one scoped read that finds a project's attachment whether
// or not it is still active.
//
// WHY THIS IS A MODULE AND NOT A METHOD. Two surfaces answer "what is this
// project's connection doing": `getState` on the connections service, and the
// `state` field on the onboarding counter. A second copy of the branch order
// is a D11 wire waiting to be severed — one surface would say
// `connected_never_polled` while the other said `connected_no_events_yet` for
// the same row, and nothing would fail. There is one function, and both
// callers hand it the same two facts.
//
// The function itself is PURE: no I/O, no clock. Both facts it consumes are
// gathered by the caller from persisted state, never from a transient signal
// (D4) — a customer landing after a poll completed must see what happened,
// not a loading state.
import type { ConnectionState, ConnectionSummary, TenantContext } from "@growthmind/shared";
import { and, desc, eq } from "drizzle-orm";

import { toConnectionSummary } from "../repositories/project-connections.repo";
import type { ScopedDb } from "../repositories/types";
import { projectConnections } from "../schema/project-connections";

/**
 * What separates the three "connected" states. Both are read from PERSISTED
 * rows rather than from anything the current request observed.
 */
export interface ConnectionActivity {
  /** At least one poll run reached `completed`. Distinct from "we have a
   * watermark": a watermark can be seeded, a completed run cannot. */
  hasCompletedPoll: boolean;
  /** At least one event row exists for the project. */
  hasEvents: boolean;
}

/**
 * The seven states, in the one order that makes them pairwise exclusive:
 *
 * 1. no row at all              → `not_connected`
 * 2. deactivated                → `disconnected`   (rows already collected are kept)
 * 3. health `validating`        → `validating`
 * 4. health `failing`           → `failing`
 * 5. healthy, no completed poll → `connected_never_polled`
 * 6. healthy, polled, events    → `connected_receiving`
 * 7. healthy, polled, no events → `connected_no_events_yet`
 *
 * 5 and 7 are the ones a naive implementation collapses. "We have not looked
 * yet" and "we looked and your product was quiet" are different answers to
 * the same 0, and only one of them is a reason to check the key.
 */
export function deriveConnectionState(
  connection: ConnectionSummary | null,
  activity: ConnectionActivity,
): ConnectionState {
  if (!connection) {
    return { status: "not_connected" };
  }

  // Deactivation wins over health: a disconnected row's stored health is
  // already `disconnected`, and reading `is_active` first means a row
  // deactivated while failing still reads as the deliberate act it was.
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

/**
 * The project's attachment, ACTIVE OR NOT — which is why this is not
 * `getActiveForProject`. `disconnected` is one of the seven states a screen
 * must be able to render, and an active-only read cannot express it: it would
 * answer `not_connected` for a project the customer deliberately detached,
 * losing the "everything we already collected is still here" reassurance.
 *
 * D7: `organization_id` is named in the predicate directly. A foreign org
 * supplying another org's project id gets `null`, never a summary.
 *
 * Ordering is `is_active desc, connected_at desc` so the live attachment wins
 * whenever a detached predecessor is still on record from a cutover.
 */
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
