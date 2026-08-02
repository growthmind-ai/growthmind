import { randomUUID } from "node:crypto";

import { index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { analysisRuns } from "./analysis-runs";
import { organization } from "./auth";
import { projects } from "./projects";

export const analysisModelCalls = pgTable(
  "analysis_model_calls",
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

    runId: text("run_id")
      .notNull()
      .references(() => analysisRuns.id, { onDelete: "restrict" }),

    signature: text("signature").notNull(),

    signatureVersion: integer("signature_version").notNull(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("analysis_model_calls_org_project_signature_key").on(
      table.organizationId,
      table.projectId,
      table.signature,
    ),

    index("analysis_model_calls_organization_id_idx").on(table.organizationId),

    index("analysis_model_calls_org_project_idx").on(table.organizationId, table.projectId),
  ],
);
