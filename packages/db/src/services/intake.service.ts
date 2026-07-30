// The SINGLE write path for `sessions` and `events` (O-003 D-9, FR-14).
//
// Everything the classifier consumes is stamped on the session row here, so a
// stored stamp is reproducible from persisted data alone with zero vendor
// access — the exact property the future `exclusions.backfill` depends on.
//
// Persists on BOTH pull outcomes. The walk is newest-first, so a mid-walk
// failure has already retrieved the newest events; those are written and the
// watermark is NOT advanced (FR-22). Partial progress survives by contract,
// not by hope.
//
// TYPED STUB (O-003 scaffold): signatures and return types are final; bodies
// throw.
import type { SessionSourcePullResult, TenantContext } from "@growthmind/shared";

import type { ScopedDb } from "../repositories/types";

/** The connection fields the intake needs. Nothing credential-bearing. */
export interface IntakeConnection {
  id: string;
  projectId: string;
  /** What the classifier will see, and what gets stamped on each session as
   * `internal_domain_at_stamp` — the provenance of the stamp, not the
   * project's current domain. */
  inferredInternalDomain: string | null;
}

export interface IntakeCounts {
  eventsReceived: number;
  eventsPersisted: number;
  sessionsTouched: number;
  eventsDroppedMalformed: number;
}

/**
 * Assembles session rows, runs `classifyExclusion` against
 * `CURRENT_EXCLUSION_RULE_SET`, upserts sessions, then inserts events keyed to
 * them.
 *
 * Sessions before events, deliberately: `events.session_id` is a foreign key,
 * so the session row must exist first, and the session upsert is idempotent
 * so a retry re-establishes the linkage rather than orphaning it.
 */
export function persistPullResult(
  _db: ScopedDb,
  _ctx: TenantContext,
  _input: { connection: IntakeConnection; result: SessionSourcePullResult },
): Promise<IntakeCounts> {
  throw new Error("TYPED STUB (O-003 scaffold): persistPullResult");
}
