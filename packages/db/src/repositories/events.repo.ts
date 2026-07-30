// Repository for the `events` table. D-B: org-scoped at construction, no
// organization id parameter.
import type { TenantContext } from "@growthmind/shared";
import { and, desc, eq, inArray } from "drizzle-orm";

import { events } from "../schema/events";
import { projects } from "../schema/projects";
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

export function createEventsRepo(db: ScopedDb, ctx: TenantContext): EventsRepo {
  return {
    async insertManyIgnoringDuplicates(rows: readonly EventInsertRow[]): Promise<number> {
      if (rows.length === 0) {
        return 0;
      }

      // ---------------------------------------------------------------------
      // D7 — the lower-severity sibling of the `sessions` vector, closed by
      // the same mechanism.
      //
      // `DO NOTHING` means a foreign org can never WRITE over another org's
      // event. It could, however, SUPPRESS one: pre-claiming
      // `(project_id, source_event_id)` on someone else's project would make
      // the real event's later insert a silent no-op — the row would simply
      // never appear, reading as "quiet product" rather than as an error.
      //
      // The same ownership filter the sessions upsert uses closes it for
      // free, so it is applied rather than merely noted. Rows naming a project
      // this context does not own are dropped before the write.
      // ---------------------------------------------------------------------
      const requestedProjectIds = [...new Set(rows.map((row) => row.projectId))];
      const ownedProjects = await db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.organizationId, ctx.organizationId),
            inArray(projects.id, requestedProjectIds),
          ),
        );
      const ownedProjectIds = new Set(ownedProjects.map((project) => project.id));

      const ourRows = rows.filter((row) => ownedProjectIds.has(row.projectId));
      if (ourRows.length === 0) {
        return 0;
      }

      const inserted = await db
        .insert(events)
        .values(
          ourRows.map((row) => ({
            organizationId: ctx.organizationId,
            projectId: row.projectId,
            connectionId: row.connectionId,
            sessionId: row.sessionId,
            sourceEventId: row.sourceEventId,
            name: row.name,
            occurredAt: row.occurredAt,
            urlPath: row.urlPath,
          })),
        )
        .onConflictDoNothing({ target: [events.projectId, events.sourceEventId] })
        // No-arg `.returning()` — the projected form does not resolve across
        // the `ScopedDb` union (NodePgDatabase | PgliteDatabase), and every
        // other repository here uses the same no-arg call.
        .returning();

      return inserted.length;
    },

    async listForProject(projectId: string, options: { limit: number }): Promise<EventRecord[]> {
      return db
        .select()
        .from(events)
        .where(and(eq(events.organizationId, ctx.organizationId), eq(events.projectId, projectId)))
        .orderBy(desc(events.occurredAt))
        .limit(options.limit);
    },

    async listForSession(sessionId: string, options: { limit: number }): Promise<EventRecord[]> {
      return db
        .select()
        .from(events)
        .where(and(eq(events.organizationId, ctx.organizationId), eq(events.sessionId, sessionId)))
        .orderBy(desc(events.occurredAt))
        .limit(options.limit);
    },
  };
}
