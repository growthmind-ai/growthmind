import { randomUUID } from "node:crypto";

import type {
  NotificationAudience,
  NotificationChannel,
  NotificationPayload,
  NotificationSendStatus,
  NotificationSubjectKind,
  NotificationType,
} from "@growthmind/shared";
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth";

const NOTIFICATION_TYPES = [
  "finding_delivered",
  "keys_revoked",
  "agent_first_contact",
  "key_created",
  "backfill_complete",
  "slack_disconnected",
  "analysis_failing",
  "digest",
] as const satisfies readonly [NotificationType, ...NotificationType[]];

const NOTIFICATION_AUDIENCES = ["org", "owner"] as const satisfies readonly [
  NotificationAudience,
  ...NotificationAudience[],
];

const NOTIFICATION_SUBJECT_KINDS = [
  "finding",
  "agent_key",
  "slack_connection",
  "source_connection",
  "project",
  "organization",
] as const satisfies readonly [NotificationSubjectKind, ...NotificationSubjectKind[]];

const NOTIFICATION_CHANNELS = ["slack", "web_push"] as const satisfies readonly [
  NotificationChannel,
  ...NotificationChannel[],
];

const NOTIFICATION_SEND_STATUSES = [
  "pending",
  "sent",
  "failed",
  "quiet",
] as const satisfies readonly [NotificationSendStatus, ...NotificationSendStatus[]];

// The fact, stored once; every renderer reads this row rather than a copy of it.
export const notifications = pgTable(
  "notifications",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    type: text("type", { enum: NOTIFICATION_TYPES }).notNull(),

    // D1 as a column; v1 always writes "org".
    audience: text("audience", { enum: NOTIFICATION_AUDIENCES }).notNull(),

    subjectKind: text("subject_kind", { enum: NOTIFICATION_SUBJECT_KINDS }).notNull(),

    // Stable minted ids only (D12), never a derived or display value.
    subjectId: text("subject_id").notNull(),

    // The FK rejects machine principals by construction: `api-key:<id>` is not a user row,
    // so the stamp seam stores null rather than a synthetic id.
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),

    payload: jsonb("payload").$type<NotificationPayload>().notNull(),

    dedupKey: text("dedup_key").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // THE once-ever / D3 mechanism: emit inserts on conflict do nothing against this key.
    uniqueIndex("notifications_org_dedup_key_uidx").on(table.organizationId, table.dedupKey),

    index("notifications_org_created_at_idx").on(table.organizationId, table.createdAt),

    // Serves the per-subject emit cooldown and the digest's since-the-last-summary read:
    // both ask "the newest row of this type for this subject", and neither may fall back
    // to the org-wide index and scan the record's tail.
    index("notifications_org_type_subject_created_at_idx").on(
      table.organizationId,
      table.type,
      table.subjectId,
      table.createdAt,
    ),
  ],
);

// One row per channel target attempt/decision — the receipt layer. Silence gets a row
// too: `quiet` with a stated reason is a receipt, not an absence.
export const notificationSends = pgTable(
  "notification_sends",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    notificationId: text("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),

    channel: text("channel", { enum: NOTIFICATION_CHANNELS }).notNull(),

    // A Slack channel id, or NOTIFICATION_SEND_NO_TARGET when no channel existed.
    target: text("target").notNull(),

    status: text("status", { enum: NOTIFICATION_SEND_STATUSES }).notNull(),

    quietReason: text("quiet_reason"),

    // A closed-union CODE, never prose and never vendor text; the sentence renders at read.
    failureReason: text("failure_reason"),

    // Written beside `target` at send time from the connection's channel name, so a
    // repoint or a disconnect cannot relabel a receipt that has already happened — and no
    // channel id can reach a customer-facing string.
    channelLabel: text("channel_label"),

    messageRef: text("message_ref"),

    sentAt: timestamp("sent_at", { withTimezone: true }),

    // The lease. A claim older than the dispatch TTL is a crashed process, not a slow one,
    // and the claim statement's own predicate is what decides that — never a read.
    claimedAt: timestamp("claimed_at", { withTimezone: true }),

    attempts: integer("attempts").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // D3/D4: a retry keys into the same row instead of writing a second receipt.
    uniqueIndex("notification_sends_notification_channel_target_uidx").on(
      table.notificationId,
      table.channel,
      table.target,
    ),

    index("notification_sends_organization_id_idx").on(table.organizationId),
  ],
);

// Per viewer, two watermarks. The badge fact (opened_at) and the read fact (read_before)
// are different facts told separately, and never share a predicate.
export const notificationBellState = pgTable(
  "notification_bell_state",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    openedAt: timestamp("opened_at", { withTimezone: true }),

    readBefore: timestamp("read_before", { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.userId] })],
);

// Individual row reads after read_before; the OR of the two is the read predicate (D-5),
// computed only in the repository's SQL.
export const notificationReads = pgTable(
  "notification_reads",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    notificationId: text("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    readAt: timestamp("read_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.notificationId, table.userId] }),

    index("notification_reads_org_user_idx").on(table.organizationId, table.userId),
  ],
);
