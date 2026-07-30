import { randomUUID } from "node:crypto";

import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { projectConnections } from "./project-connections";
import { projects } from "./projects";
import { sessions } from "./sessions";

/**
 * The raw event stream (O-003 D-4, D-12).
 *
 * UNPARTITIONED, deliberately. Drizzle-kit's declarative generator does not
 * emit `PARTITION BY`, and this repo's rule is that migrations are generated,
 * never hand-written. More importantly, Postgres requires the partition key
 * to be a member of every unique index — so the idempotency key below would
 * have to become `(project_id, source_event_id, occurred_at)` and would hold
 * only WITHIN a partition. A late-arriving duplicate whose declared timestamp
 * crossed a month boundary would then insert twice: a correctness regression
 * on this sprint's headline dedup key, paid now, for throughput we do not
 * have. Two cheap things keep the retrofit cheap: `occurred_at` is
 * `timestamptz` and indexed as `(project_id, occurred_at)`, and no query in
 * this sprint orders or aggregates across projects.
 *
 * NO `properties` jsonb column, on privacy grounds first. Vendor event
 * properties routinely carry emails, names, and urls bearing tokens;
 * product-decisions §5 forbids that in the stream, and no residual scanner
 * ships this sprint. When the scanner lands, a typed column per required
 * property — a visible, reviewable migration — is the intended path, never a
 * blob. Secondarily: a jsonb column holds every shape ever written, and not
 * creating one is strictly better than coercing one.
 */
export const events = pgTable(
  "events",
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
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    /**
     * The vendor's server-assigned event id. Opaque TEXT, not a `uuid`
     * column: it happens to be a UUIDv7 in this deployment, which is an
     * observation rather than a contract. Server-assigned with no derived
     * input, so it is not a D12 fork risk.
     */
    sourceEventId: text("source_event_id").notNull(),
    /** The event name, as-is. Never re-authored. */
    name: text("name").notNull(),
    /**
     * The vendor's CLIENT-DECLARED event time. This is not an arrival time
     * and no arrival time exists upstream by any route — the event id's own
     * embedded instant tracks event time too. The two columns are named
     * `occurred_at` and `ingested_at` precisely so that confusion cannot
     * recur by reading a column name.
     */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    /** OUR clock. The only ingestion-time signal that will ever exist for
     * this data. */
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
    /** `$pathname`, or `$current_url` with the query string and fragment
     * stripped and normalised. NEVER the raw url — one campaign parameter
     * would fork the surface and every signature hanging off it (D12). */
    urlPath: text("url_path"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // THE idempotency key. Insert with `ON CONFLICT DO NOTHING`; never a
    // check-then-insert. Scoped by project, so the same upstream event id in
    // two different projects is two rows.
    uniqueIndex("events_project_source_event_id_uidx").on(table.projectId, table.sourceEventId),
    index("events_organization_id_idx").on(table.organizationId),
    index("events_project_occurred_at_idx").on(table.projectId, table.occurredAt),
    index("events_session_id_idx").on(table.sessionId),
  ],
);
