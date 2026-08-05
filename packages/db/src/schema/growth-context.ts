import { randomUUID } from "node:crypto";

import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { RESEARCH_STATUSES } from "@growthmind/shared";

import { organization } from "./auth";
import { projects } from "./projects";

export const growthContext = pgTable(
  "growth_context",
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

    surfaces: jsonb("surfaces").notNull().default([]),

    confirmedChangeable: jsonb("confirmed_changeable").notNull().default([]),

    // The site the business context is read from. Proposed from the org creator's email
    // domain and corrected by a person, never crawled without one of the two having said so.
    siteDomain: text("site_domain"),

    // What binds this business and how its product is used — what a coding agent is handed
    // before it changes anything.
    businessContext: jsonb("business_context").notNull().default({ facts: [] }),

    // Session analysis's answer to who turned up. No longer written by the site read, and
    // kept because the rows already written are the findings lane's, not settings'.
    icp: jsonb("icp").notNull().default({ beliefs: [] }),

    // A person waits on this, so every exit path records where it got to.
    researchStatus: text("research_status", { enum: RESEARCH_STATUSES })
      .notNull()
      .default("never_run"),

    researchedAt: timestamp("researched_at", { withTimezone: true }),

    researchFailure: text("research_failure"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("growth_context_org_project_key").on(table.organizationId, table.projectId),

    index("growth_context_organization_id_idx").on(table.organizationId),
  ],
);
