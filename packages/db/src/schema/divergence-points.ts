import { randomUUID } from "node:crypto";

import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { projects } from "./projects";

const DIVERGENCE_KINDS = ["diverged", "no_divergence", "refused"] as const;
const DIVERGENCE_REASONS = [
  "identical_cohorts",
  "single_rank_spine",
  "no_gap_found",
  "cohort_below_floor",
] as const;

// No `grade` column: `gradeOf(reconstructedResult)` derives explained/described at read
// time (packages/core/src/divergence/grade.ts) so there is exactly one place that fact lives.
export const divergencePoints = pgTable(
  "divergence_points",
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

    surface: text("surface").notNull(),
    surfaceNormalisationVersion: integer("surface_normalisation_version"),
    spineVersion: integer("spine_version").notNull(),
    cohortMatchVersion: integer("cohort_match_version").notNull(),

    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),

    kind: text("kind", { enum: DIVERGENCE_KINDS }).notNull(),
    divergedAtRank: integer("diverged_at_rank"),
    reason: text("reason", { enum: DIVERGENCE_REASONS }),

    succeededCohortSize: integer("succeeded_cohort_size").notNull(),
    failedCohortSize: integer("failed_cohort_size").notNull(),
    succeededSessionIdsSample: jsonb("succeeded_session_ids_sample")
      .$type<readonly string[]>()
      .notNull(),
    failedSessionIdsSample: jsonb("failed_session_ids_sample").$type<readonly string[]>().notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("divergence_points_identity_key").on(
      table.organizationId,
      table.projectId,
      table.surface,
      table.cohortMatchVersion,
      table.windowStart,
      table.windowEnd,
    ),
    index("divergence_points_organization_id_idx").on(table.organizationId),
  ],
);

export const DIVERGENCE_POINTS_CONFLICT_TARGET = [
  divergencePoints.organizationId,
  divergencePoints.projectId,
  divergencePoints.surface,
  divergencePoints.cohortMatchVersion,
  divergencePoints.windowStart,
  divergencePoints.windowEnd,
];
