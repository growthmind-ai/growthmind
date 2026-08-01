import { randomUUID } from "node:crypto";

import type { DeliveryStatus } from "@growthmind/shared";
import { index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { projects } from "./projects";

// Enum tuple compile-pinned to @growthmind/shared's Zod union, the same `text({ enum
// })` + `as const satisfies` discipline `dismissals.ts` and `finding-signatures.ts`
// use. `deliveryStatusSchema` is the single source of truth; this tuple exists only so
// the column cannot drift from it. Adding a member there and not here is a compile
// error, not a runtime surprise.
const DELIVERY_STATUSES = ["pending", "posted", "failed"] as const satisfies readonly [
  DeliveryStatus,
  ...DeliveryStatus[],
];

/**
 * One row per (finding, channel) delivery. The durable record that a finding was, or is
 * being, posted somewhere ("duplicate delivery is idempotent" and "a Slack delivery
 * failure never breaks the pipeline's persisted state").
 *
 * The row is the idempotency guard `deliveries_org_finding_channel_key` is unique on
 * `(organization_id, finding_id, channel_id)`. That index (not a prior read, not an
 * in-memory set) is what makes a retried delivery a conflict instead of a second post.
 * `claimForPost` inserts against it and lets Postgres decide who owns the post; there
 * is no check-then-write window anywhere, which is the only reason two overlapping
 * scheduler ticks (or a Graphile Worker retry after a partial failure) cannot
 * double-post the same finding.
 *
 * Every exit path is terminal (`packages/shared/src/delivery/types.ts`) `status` starts
 * `pending` and must reach `posted` or `failed`. A row left `pending` forever reads to
 * the customer as silence and to the scheduler as "one already open", permanently
 * jamming the lane, so `failed` is a first-class, writable state carrying a
 * plain-English `failure_reason`, and a failed row is re-claimable (see `attempts`).
 * The finding itself is untouched by a failure: nothing on this table can make a
 * finding undeliverable, which is the whole point of the clause.
 *
 * NO FK ON `finding_id` (same precedent as `dismissals.ts`) There is no `findings`
 * table in this branch's history: shipped the candidate contract, not the table. A FK
 * here would couple this migration to a table that does not exist. `signature` is
 * carried on the row for the same reason `dismissals` carries it. The delivery history
 * for an identity resolves without joining `findings` at all. The FK is the deliberate
 * target of a later sprint, once that table exists in history this branch can build on.
 *
 * Deferral, named heir. `findings` now exists (`packages/db/src/schema/findings.ts`),
 * so the missing-table reason above has expired, and the FK is still not added, for a
 * different and cited reason: this table's shipped suites insert rows carrying
 * synthetic `finding_id` values that reference no `findings` row, and those suites are
 * frozen. The `ALTER TABLE … ADD CONSTRAINT` is cheap; repairing frozen fixtures is
 * not, and doing it inside That decision is precisely the scope creep that sprint
 * forbids. Heir: the sprint that lands the findings producer end to end (the
 * corpus-reader heir of), the same sprint that must migrate these fixtures. Owns
 * adding the FK. This paragraph is the deferral's only git-tracked home: sprint task
 * files are gitignored, so a deferral recorded only there does not exist.
 *
 * `channel_id` is the address, and there is no `channel_kind` yet Slack is the only
 * delivery channel at MVP, so the address is a Slack channel id and the unique tuple
 * ends there. A second adapter (email, a webhook) would need a `channel_kind` column
 * inside that unique tuple. An additive migration, called out here so whoever adds the
 * adapter widens the index rather than discovering two channels can collide on one id.
 *
 * What is deliberately absent No `nothing_today` rows. `deliveryDecisionSchema`'s
 * `nothing_today` is a scheduler decision about a tick, not a delivery of a finding. It
 * has no `finding_id`, so it cannot be a row here without making `finding_id` nullable
 * and voiding the unique index that this table exists for. Its persistence, if it needs
 * any, belongs to the scheduler's own table.
 *
 * No per-attempt audit rows. `attempts` counts post attempts on the one row; the row
 * always describes the current attempt. A full attempt log is a separate table if it is
 * ever needed, and would not change this one's shape.
 *
 * Closing window Nothing has shipped against this table. It lands empty in every
 * environment, so there is nothing to backfill today. That is a closing window, not a
 * standing exemption: the day a real delivery is recorded, every decision above is a
 * constraint on production data and whoever changes it owns the migration path.
 */
export const deliveries = pgTable(
  "deliveries",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Stamped by every write and filtered on by the project-scoped reads
     * (`listPendingForProject`, `findLatestForSignature`). Stamp/filter symmetry,.
     * Cascades: a deleted project's delivery history has no subject left to describe. */
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** NO FK, see the table header. */
    findingId: text("finding_id").notNull(),
    /** Carried so delivery history for an identity resolves without a join to
     * `findings`, exactly as `dismissals.signature` does. */
    signature: text("signature").notNull(),
    /** The delivery address, a Slack channel id today. Part of the unique tuple: the
     * same finding may legitimately go to two different channels, and each of those is
     * its own once-only post. */
    channelId: text("channel_id").notNull(),
    status: text("status", { enum: DELIVERY_STATUSES }).notNull().default("pending"),
    /** When the current attempt took ownership of the post. Moves forward on a re-claim
     * of a failed row, because it describes this attempt. */
    claimedAt: timestamp("claimed_at", { withTimezone: true }).defaultNow().notNull(),
    /** The instant Slack accepted it. Stamped with `coalesce` so a replayed
     * `markPosted` never moves the first-post instant. */
    postedAt: timestamp("posted_at", { withTimezone: true }),
    /** When the current attempt gave up. Cleared on a re-claim. The row describes the
     * current attempt, not the whole history. */
    failedAt: timestamp("failed_at", { withTimezone: true }),
    /** Plain English, customer-readable, and never an echo of the message body or of
     * anything the residual-PII scanner rejected: a failure reason that quotes the
     * payload copies personal data into the database and into every log line that reads
     * this row. */
    failureReason: text("failure_reason"),
    /** The channel's own identifier for the posted message (a Slack `ts`), so a later
     * thread reply can address it and so an operator can prove a post happened. Stamped
     * with `coalesce`, the first accepted post's reference is the one that stands. */
    messageRef: text("message_ref"),
    /** Post attempts made on this row. A blocked duplicate claim does not increment it
     * (only a genuine re-claim of a failed row does) so `attempts > 1` means "we really
     * tried again", never "something asked twice". */
    attempts: integer("attempts").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // The idempotency guard. Every `claimForPost` conflicts on exactly this tuple, so a
    // retried delivery of the same finding to the same channel can never become a
    // second row and therefore never a second post.
    uniqueIndex("deliveries_org_finding_channel_key").on(
      table.organizationId,
      table.findingId,
      table.channelId,
    ),
    // Every read in this repository names `organization_id` first; this is the index
    // those reads land on, matching `dismissals` and `finding_signatures`.
    index("deliveries_organization_id_idx").on(table.organizationId),
    // The scheduler's "is one already open?" read, `listPendingForProject` scans org +
    // project + status, and a stuck `pending` is exactly what it must be able to see
    // cheaply on every tick.
    index("deliveries_org_project_status_idx").on(
      table.organizationId,
      table.projectId,
      table.status,
    ),
    // "Have we already delivered this identity, and where?" answered without joining
    // `findings`. The read `findLatestForSignature` performs.
    index("deliveries_org_signature_idx").on(table.organizationId, table.signature),
  ],
);
