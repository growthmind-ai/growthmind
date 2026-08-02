import { randomUUID } from "node:crypto";

import type { AnalysisOutcome, AnalysisRunStatus, AnalysisStopReason } from "@growthmind/shared";
import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { projects } from "./projects";

const ANALYSIS_RUN_STATUSES = ["running", "completed", "failed"] as const satisfies readonly [
  AnalysisRunStatus,
  ...AnalysisRunStatus[],
];

const ANALYSIS_OUTCOMES = [
  "produced_findings",
  "no_candidates_passed_gate",
  "no_sessions_to_analyse",
] as const satisfies readonly [AnalysisOutcome, ...AnalysisOutcome[]];

const ANALYSIS_STOP_REASONS = [
  "ran_to_completion",
  "cap_exhausted",
  "fatal_error",
] as const satisfies readonly [AnalysisStopReason, ...AnalysisStopReason[]];

export const analysisRuns = pgTable(
  "analysis_runs",
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
    status: text("status", { enum: ANALYSIS_RUN_STATUSES }).notNull().default("running"),

    outcome: text("outcome", { enum: ANALYSIS_OUTCOMES }),

    stopReason: text("stop_reason", { enum: ANALYSIS_STOP_REASONS }),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),

    finishedAt: timestamp("finished_at", { withTimezone: true }),

    modelCallsAttempted: integer("model_calls_attempted").default(0).notNull(),

    candidatesUnrenderable: integer("candidates_unrenderable").default(0).notNull(),

    candidatesRefused: integer("candidates_refused").default(0).notNull(),

    resolvedModelId: text("resolved_model_id"),

    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),

    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("analysis_runs_one_open_per_project_key")
      .on(table.organizationId, table.projectId)
      .where(sql`${table.status} = 'running'`),

    index("analysis_runs_organization_id_idx").on(table.organizationId),

    index("analysis_runs_org_project_started_at_idx").on(
      table.organizationId,
      table.projectId,
      table.startedAt,
    ),
  ],
);
