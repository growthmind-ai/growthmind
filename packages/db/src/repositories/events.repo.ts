// Repository for the `events` table. D-B: org-scoped at construction, no
// organization id parameter.
//
// TYPED STUB (O-003 scaffold): signatures and return types are final; bodies
// throw.
import type { TenantContext } from "@growthmind/shared";

import type { events } from "../schema/events";
import type { ScopedDb } from "./types";

export type EventRecord = typeof events.$inferSelect;

export interface EventInsertRow {
  projectId: string;
  connectionId: string;
  sessionId: string;
  /** The vendor's server-assigned event id — the dedup key. */
  sourceEventId: string;
  name: string;
  occurredAt: Date;
  urlPath: string | null;
}

export interface EventsRepo {
  /**
   * `ON CONFLICT (project_id, source_event_id) DO NOTHING`, returning the
   * number of rows actually inserted. NEVER a check-then-insert: the overlap
   * window deliberately re-requests events we already hold, and the unique
   * index — not a prior read — is what makes re-applying a pull produce
   * exactly one row per event (FR-6 / D6).
   */
  insertManyIgnoringDuplicates(rows: readonly EventInsertRow[]): Promise<number>;
  /** Org-filtered list for one project, newest first by `occurred_at`. */
  listForProject(projectId: string, options: { limit: number }): Promise<EventRecord[]>;
  /** Org-filtered list for one session. */
  listForSession(sessionId: string, options: { limit: number }): Promise<EventRecord[]>;
}

export function createEventsRepo(_db: ScopedDb, _ctx: TenantContext): EventsRepo {
  throw new Error("TYPED STUB (O-003 scaffold): createEventsRepo");
}
