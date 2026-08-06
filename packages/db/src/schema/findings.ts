import { randomUUID } from "node:crypto";

import type { DetectorName } from "@growthmind/core";
import type { SummarySource } from "@growthmind/shared";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { analysisRuns } from "./analysis-runs";
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

// A finding's detector, persisted rather than inferred from its count shape (decision 0016) —
// two detectors can declare the same count arity, and an arity-keyed lookup silently collided.
const DETECTORS = [
  "funnel_dropoff",
  "error_event",
  "observed_struggle",
] as const satisfies readonly [DetectorName, ...DetectorName[]];

const SURFACE_ROLES = ["surface"] as const;

export const findings = pgTable(
  "findings",
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

    detector: text("detector", { enum: DETECTORS }).notNull(),

    summarySource: text("summary_source", { enum: SUMMARY_SOURCES }).notNull(),
    headline: text("headline").notNull(),

    context: jsonb("context").notNull(),

    finalClass: text("final_class").notNull(),
    surface: text("surface").notNull(),

    surfaceRole: text("surface_role", { enum: SURFACE_ROLES }).notNull().default("surface"),

    surfaceNormalisationVersion: integer("surface_normalisation_version"),

    counts: jsonb("counts").notNull(),

    confidenceBasis: text("confidence_basis").notNull(),

    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),

    evidenceShape: text("evidence_shape").notNull(),
    evidenceShapeVersion: integer("evidence_shape_version").notNull(),

    resolvedModelId: text("resolved_model_id"),

    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("findings_org_project_signature_key").on(
      table.organizationId,
      table.projectId,
      table.signature,
    ),
    index("findings_organization_id_idx").on(table.organizationId),

    index("findings_org_project_created_at_idx").on(
      table.organizationId,
      table.projectId,
      table.createdAt,
    ),

    index("findings_org_run_id_idx").on(table.organizationId, table.runId),
  ],
);
