import { randomUUID } from "node:crypto";

import type { ReplayEventsStop, ReplaySourceKind, SummarySource } from "@growthmind/shared";
import { sql } from "drizzle-orm";
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

const REPLAY_PROVIDERS = ["rrweb", "posthog"] as const satisfies readonly [
  ReplaySourceKind,
  ...ReplaySourceKind[],
];

// A pull that failed is a terminal state of the pull, so it sits in the same column as the
// three the adapter reports rather than in a second nullable flag beside it.
export type TranscriptPullStop = ReplayEventsStop | "failed";

const PULL_STOPS = ["exhausted", "page_cap", "byte_cap", "failed"] as const satisfies readonly [
  TranscriptPullStop,
  ...TranscriptPullStop[],
];

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

    provider: text("provider", { enum: REPLAY_PROVIDERS }).notNull().default("posthog"),

    // Null carries two meanings, and both are legitimate: a row written before 0021, and a
    // provider with no session-key mapping. Neither can join, and neither is an error.
    sessionKey: text("session_key"),
    sessionGroupingVersion: integer("session_grouping_version"),

    actions: jsonb("actions"),
    actionsVersion: integer("actions_version"),
    actionsOmitted: integer("actions_omitted"),

    pullStop: text("pull_stop", { enum: PULL_STOPS }),
    pullReason: text("pull_reason"),
    pullWatermarkAt: timestamp("pull_watermark_at", { withTimezone: true }),

    // Nullable rather than zero-defaulted: the rrweb source reads parsed JSON and can never
    // report a byte count, so "not measured" has to stay distinguishable from "measured zero".
    bytesReceived: integer("bytes_received"),

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

    // One transcript per session. Partial, so keyless rows are exempt; a derivation that stops
    // being injective raises here instead of letting two transcripts claim one session.
    uniqueIndex("recording_summaries_org_project_session_key_uidx")
      .on(table.organizationId, table.projectId, table.sessionKey)
      .where(sql`${table.sessionKey} is not null`),

    index("recording_summaries_organization_id_idx").on(table.organizationId),

    index("recording_summaries_org_project_started_at_idx").on(
      table.organizationId,
      table.projectId,
      table.startedAt,
    ),
  ],
);
