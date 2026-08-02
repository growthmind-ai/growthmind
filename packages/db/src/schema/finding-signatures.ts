import { randomUUID } from "node:crypto";

import type { FindingClass } from "@growthmind/core";
import { index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { projects } from "./projects";

const FINDING_CLASSES = [
  "broken",
  "confusing",
  "changed_mind",
  "instrumentation",
] as const satisfies readonly [FindingClass, ...FindingClass[]];

export const findingSignatures = pgTable(
  "finding_signatures",
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

    signature: text("signature").notNull(),
    symptomClass: text("symptom_class", { enum: FINDING_CLASSES }).notNull(),

    surface: text("surface").notNull(),
    signatureTupleVersion: integer("signature_tuple_version").notNull(),
    evidenceShapeVersion: integer("evidence_shape_version").notNull(),

    surfaceNormalisationVersion: integer("surface_normalisation_version"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    timesSeen: integer("times_seen").default(1).notNull(),

    deliveredAt: timestamp("delivered_at", { withTimezone: true }),

    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("finding_signatures_org_project_signature_key").on(
      table.organizationId,
      table.projectId,
      table.signature,
    ),
    index("finding_signatures_organization_id_idx").on(table.organizationId),
  ],
);
