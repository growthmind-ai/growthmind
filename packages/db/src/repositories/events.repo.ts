import type { TenantContext } from "@growthmind/shared";
import { desc, eq } from "drizzle-orm";

import { events } from "../schema/events";
import { orgCrud } from "./crud";
import { scoped } from "./scope";
import type { ScopedExecutor } from "./types";

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

export function createEventsRepo(db: ScopedExecutor, ctx: TenantContext): EventsRepo {
  const s = scoped(db, ctx);
  const c = orgCrud(db, ctx, events);

  return {
    async insertManyIgnoringDuplicates(rows: readonly EventInsertRow[]): Promise<number> {
      if (rows.length === 0) {
        return 0;
      }

      const ownedProjectIds = await s.ownedProjectIds(rows.map((row) => row.projectId));

      const ourRows = rows.filter((row) => ownedProjectIds.has(row.projectId));
      if (ourRows.length === 0) {
        return 0;
      }

      const inserted = await db
        .insert(events)
        .values(
          ourRows.map((row) => ({
            organizationId: s.stamp.organizationId,
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
        .returning();

      return inserted.length;
    },

    async listForProject(projectId: string, options: { limit: number }): Promise<EventRecord[]> {
      return c.list({
        where: eq(events.projectId, projectId),
        orderBy: [desc(events.occurredAt)],
        limit: options.limit,
      });
    },

    async listForSession(sessionId: string, options: { limit: number }): Promise<EventRecord[]> {
      return c.list({
        where: eq(events.sessionId, sessionId),
        orderBy: [desc(events.occurredAt)],
        limit: options.limit,
      });
    },
  };
}
