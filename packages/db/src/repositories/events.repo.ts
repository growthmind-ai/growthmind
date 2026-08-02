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

  sourceEventId: string;
  name: string;
  occurredAt: Date;
  urlPath: string | null;

  urlPathNormalisationVersion: number | null;
}

export interface EventsRepo {
  insertManyIgnoringDuplicates(rows: readonly EventInsertRow[]): Promise<number>;

  listForProject(projectId: string, options: { limit: number }): Promise<EventRecord[]>;

  listForSession(sessionId: string, options: { limit: number }): Promise<EventRecord[]>;
}

export function createEventsRepo(db: ScopedDb, ctx: TenantContext): EventsRepo {
  return {
    async insertManyIgnoringDuplicates(rows: readonly EventInsertRow[]): Promise<number> {
      if (rows.length === 0) {
        return 0;
      }

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
            urlPathNormalisationVersion: row.urlPathNormalisationVersion,
          })),
        )
        .onConflictDoNothing({ target: [events.projectId, events.sourceEventId] })
        // No-arg `.returning`, the projected form does not resolve across the
        // `ScopedDb` union (NodePgDatabase | PgliteDatabase), and every other
        // repository here uses the same no-arg call.
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
