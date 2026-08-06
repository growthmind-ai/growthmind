import { randomUUID } from "node:crypto";

import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { findings } from "./findings";
import { projects } from "./projects";

// One row per finding, written only when the citation gate had something to accept or
// reject (ADD Decision 3) — a claims: [] row is never written for "model found nothing"
// or a malformed/refused response, both of which stay row-absent (same as never-attempted).
// No beat data or recording id here: at read time the evidence builder re-derives BeatView[]
// from `anchorSessionId` via citationsFor, the same "derive, don't duplicate" discipline
// divergence_points already established for its own grade.
export const causeClaims = pgTable(
  "cause_claims",
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
    findingId: text("finding_id")
      .notNull()
      .references(() => findings.id, { onDelete: "cascade" }),

    anchorSessionId: text("anchor_session_id").notNull(),

    claims: jsonb("claims")
      .$type<readonly { statement: string; citesBeats: readonly number[] }[]>()
      .notNull(),
    droppedClaims: integer("dropped_claims").notNull(),

    resolvedModelId: text("resolved_model_id"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("cause_claims_org_project_finding_key").on(
      table.organizationId,
      table.projectId,
      table.findingId,
    ),
    index("cause_claims_organization_id_idx").on(table.organizationId),
  ],
);

export const CAUSE_CLAIMS_CONFLICT_TARGET = [
  causeClaims.organizationId,
  causeClaims.projectId,
  causeClaims.findingId,
];
