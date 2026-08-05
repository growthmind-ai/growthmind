import { randomUUID } from "node:crypto";

import type { SummarySource } from "@growthmind/shared";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { projects } from "./projects";

const SUMMARY_SOURCES = [
  "model_rendered",
  "floor_no_key_configured",
  "floor_cap_exhausted",
  "floor_model_call_failed",
  "floor_model_output_invalid",
  "floor_model_text_rejected",
] as const satisfies readonly [SummarySource, ...SummarySource[]];

export const recordingSummaries = pgTable(
  "recording_summaries",
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

    recordingId: text("recording_id").notNull(),

    summarySource: text("summary_source", { enum: SUMMARY_SOURCES }).notNull(),
    headline: text("headline").notNull(),
    context: jsonb("context").notNull(),

    transcript: text("transcript").notNull(),

    pages: jsonb("pages").notNull(),
    durationMs: integer("duration_ms").notNull(),
    actionCount: integer("action_count").notNull(),
    notableCount: integer("notable_count").notNull(),
    droppedEvents: integer("dropped_events").notNull(),

    startedAt: timestamp("started_at", { withTimezone: true }),

    resolvedModelId: text("resolved_model_id"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // The dedup key for the poll: a recording re-listed by a later page, or a task retried
    // after a partial run, updates its row instead of minting a second summary (D4).
    uniqueIndex("recording_summaries_project_recording_key").on(
      table.organizationId,
      table.projectId,
      table.recordingId,
    ),

    index("recording_summaries_organization_id_idx").on(table.organizationId),

    index("recording_summaries_org_project_started_at_idx").on(
      table.organizationId,
      table.projectId,
      table.startedAt,
    ),
  ],
);
