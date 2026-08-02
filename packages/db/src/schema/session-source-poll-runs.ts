import { randomUUID } from "node:crypto";

import type { PollRunOutcome, PollRunStatus, SourceFailureCode } from "@growthmind/shared";
import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { projectConnections } from "./project-connections";
import { projects } from "./projects";

const POLL_RUN_STATUSES = ["running", "completed", "failed"] as const satisfies readonly [
  PollRunStatus,
  ...PollRunStatus[],
];

const POLL_RUN_OUTCOMES = ["with_events", "no_new_events"] as const satisfies readonly [
  PollRunOutcome,
  ...PollRunOutcome[],
];

const FAILURE_CODES = [
  "invalid_credentials",
  "project_not_found",
  "unreachable",
  "rate_limited",
  "misconfigured",
] as const satisfies readonly [SourceFailureCode, ...SourceFailureCode[]];

export const sessionSourcePollRuns = pgTable(
  "session_source_poll_runs",
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
    connectionId: text("connection_id")
      .notNull()
      .references(() => projectConnections.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: text("status", { enum: POLL_RUN_STATUSES }).notNull(),
    outcome: text("outcome", { enum: POLL_RUN_OUTCOMES }),
    failureCode: text("failure_code", { enum: FAILURE_CODES }),

    failureMessage: text("failure_message"),
    eventsReceived: integer("events_received").default(0).notNull(),
    eventsPersisted: integer("events_persisted").default(0).notNull(),

    eventsDroppedMalformed: integer("events_dropped_malformed").default(0).notNull(),
    sessionsTouched: integer("sessions_touched").default(0).notNull(),
    pagesFetched: integer("pages_fetched").default(0).notNull(),
    identityLookupsUsed: integer("identity_lookups_used").default(0).notNull(),

    watermarkAdvancedTo: timestamp("watermark_advanced_to", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("session_source_poll_runs_organization_id_idx").on(table.organizationId),
    index("session_source_poll_runs_connection_finished_at_idx").on(
      table.connectionId,
      table.finishedAt,
    ),
  ],
);
