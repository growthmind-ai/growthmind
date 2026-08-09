import { randomUUID } from "node:crypto";

import {
  NO_CONTROL_LABEL,
  SHIPPED_ABANDONED_REASONS,
  SHIPPED_CHANGE_STATES,
  SHIPPED_CORPUS_KINDS,
  SHIPPED_LEAD_COUNTS,
} from "@growthmind/shared";
import { index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { projects } from "./projects";

// A change the customer shipped without asking us, and the clock it is measured against.
export const shippedChanges = pgTable(
  "shipped_changes",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    // Nullable, and `set null` rather than cascade: a cascade would delete the very row whose
    // terminal state records that the project is gone, and `restrict` would stop it ever going.
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),

    page: text("page").notNull(),

    // The page is a normalised url path, and the normaliser is versioned, so a version bump
    // between report and readout is detectable rather than a silent re-spelling.
    pageNormalisationVersion: integer("page_normalisation_version").notNull(),

    // Postgres treats NULLs as distinct in a unique index, so the whole-page case carries the
    // NO_CONTROL_LABEL sentinel and never a null.
    controlLabel: text("control_label").notNull().default(NO_CONTROL_LABEL),

    description: text("description").notNull(),

    corpusKind: text("corpus_kind", { enum: SHIPPED_CORPUS_KINDS }).notNull(),

    readoutDueAt: timestamp("readout_due_at", { withTimezone: true }).notNull(),

    leadCount: text("lead_count", { enum: SHIPPED_LEAD_COUNTS }).notNull().default("reach"),

    state: text("state", { enum: SHIPPED_CHANGE_STATES }).notNull().default("reported"),

    // A closed union of codes, never prose, after notification_sends.failure_reason.
    abandonedReason: text("abandoned_reason", { enum: SHIPPED_ABANDONED_REASONS }),

    reportedAt: timestamp("reported_at", { withTimezone: true }).notNull(),
    readOutAt: timestamp("read_out_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Plain, four real columns, no partial predicate and no expression: a re-report of the
    // same change keys into this row rather than starting a second clock.
    uniqueIndex("shipped_changes_change_key_uidx").on(
      table.organizationId,
      table.projectId,
      table.page,
      table.controlLabel,
    ),

    index("shipped_changes_organization_id_idx").on(table.organizationId),

    index("shipped_changes_org_state_readout_due_at_idx").on(
      table.organizationId,
      table.state,
      table.readoutDueAt,
    ),

    index("shipped_changes_org_state_read_out_at_idx").on(
      table.organizationId,
      table.state,
      table.readOutAt,
    ),
  ],
);
