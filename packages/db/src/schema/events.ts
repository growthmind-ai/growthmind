import { randomUUID } from "node:crypto";

import { index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { projectConnections } from "./project-connections";
import { projects } from "./projects";
import { sessions } from "./sessions";

/**
 * The raw event stream.
 *
 * Unpartitioned, deliberately. Drizzle-kit's declarative generator does not emit
 * `PARTITION BY`, and this repo's rule is that migrations are generated, never
 * hand-written. More importantly, Postgres requires the partition key to be a member of
 * every unique index, so the idempotency key below would have to become `(project_id,
 * source_event_id, occurred_at)` and would hold only within a partition. A
 * late-arriving duplicate whose declared timestamp crossed a month boundary would then
 * insert twice: a correctness regression on this sprint's headline dedup key, paid now,
 * for throughput we do not have. Two cheap things keep the retrofit cheap:
 * `occurred_at` is `timestamptz` and indexed as `(project_id, occurred_at)`, and no
 * query in this sprint orders or aggregates across projects.
 *
 * NO `properties` jsonb column, on privacy grounds first. Vendor event properties
 * routinely carry emails, names, and urls bearing tokens; product-decisions forbids
 * that in the stream, and no residual scanner ships this sprint. When the scanner
 * lands, a typed column per required property (a visible, reviewable migration) is the
 * intended path, never a blob. Secondarily: a jsonb column holds every shape ever
 * written, and not creating one is strictly better than coercing one.
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
     * The vendor's server-assigned event id. Opaque text, not a `uuid` column: it
     * happens to be a UUIDv7 in this deployment, which is an observation rather than a
     * contract. Server-assigned with no derived input, so it is not a fork risk.
     */
    sourceEventId: text("source_event_id").notNull(),
    /** The event name, as-is. Never re-authored. */
    name: text("name").notNull(),
    /**
     * The vendor's client-declared event time. This is not an arrival time and no
     * arrival time exists upstream by any route. The event id's own embedded instant
     * tracks event time too. The two columns are named `occurred_at` and `ingested_at`
     * precisely so that confusion cannot recur by reading a column name.
     */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    /** Our clock. The only ingestion-time signal that will ever exist for this data. */
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
    /** `$pathname`, or `$current_url` with the query string and fragment stripped and
     * normalised. Never the raw url, one campaign parameter would fork the surface and
     * every signature hanging off it. */
    urlPath: text("url_path"),
    /**
     * Which `normaliseUrlPath` rules produced `url_path` above.
     *
     * Nullable, and `null` is not `0`. A row written before this column existed reads
     * back `null`, meaning "written before versions were recorded. Redaction status
     * unknown". Coercing that to `0` would assert a version we never wrote.
     *
     * This is a product-decisions privacy-remediability requirement before it is a one.
     * `url-path.ts` documents that a stored v1 path may still carry a live reset token
     * or an email address; the constant is already at
     * 2. This column is the only field that could ever identify those rows, `events`
     *  keeps no `properties` jsonb and no raw `$current_url` to re-derive from, so a
     *  later remediation migration finds its work with `WHERE
     *  url_path_normalisation_version IS NULL`, and `null` is precisely
     *  the class it must be able to select.
     */
    urlPathNormalisationVersion: integer("url_path_normalisation_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // The idempotency key. Insert with `ON CONFLICT DO NOTHING`; never a
    // check-then-insert. Scoped by project, so the same upstream event id in two
    // different projects is two rows.
    uniqueIndex("events_project_source_event_id_uidx").on(table.projectId, table.sourceEventId),
    index("events_organization_id_idx").on(table.organizationId),
    index("events_project_occurred_at_idx").on(table.projectId, table.occurredAt),
    index("events_session_id_idx").on(table.sessionId),
  ],
);
