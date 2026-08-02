import { randomUUID } from "node:crypto";

import type { AncestryReason } from "@growthmind/shared";
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { projects } from "./projects";

const ANCESTRY_REASONS = [
  "surface_normalisation_version_bump",
  "evidence_shape_version_bump",
  "signature_tuple_version_bump",
  "surface_rename",
  "surface_derivation_swap",
] as const satisfies readonly [AncestryReason, ...AncestryReason[]];

export const signatureAncestry = pgTable(
  "signature_ancestry",
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
    oldSignature: text("old_signature").notNull(),
    newSignature: text("new_signature").notNull(),
    reason: text("reason", { enum: ANCESTRY_REASONS }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("signature_ancestry_org_old_signature_key").on(
      table.organizationId,
      table.oldSignature,
    ),
    index("signature_ancestry_organization_id_idx").on(table.organizationId),
  ],
);
