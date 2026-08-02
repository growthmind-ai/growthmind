import { randomUUID } from "node:crypto";

import { index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { projectConnections } from "./project-connections";
import { projects } from "./projects";
import { sessions } from "./sessions";

export const events = pgTable(
  "events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => projectConnections.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),

    sourceEventId: text("source_event_id").notNull(),

    name: text("name").notNull(),

    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),

    ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),

    urlPath: text("url_path"),

    urlPathNormalisationVersion: integer("url_path_normalisation_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("events_project_source_event_id_uidx").on(table.projectId, table.sourceEventId),
    index("events_organization_id_idx").on(table.organizationId),
    index("events_project_occurred_at_idx").on(table.projectId, table.occurredAt),
    index("events_session_id_idx").on(table.sessionId),
  ],
);
