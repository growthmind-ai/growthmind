import type { MutableNotificationClass } from "@growthmind/shared";
import { sql } from "drizzle-orm";
import { check, index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { organization, user } from "./auth";

// `act_now` is absent, and that absence is the enforcement rather than a check: there is
// no row this column would accept that could hide a health or security notification.
const MUTABLE_NOTIFICATION_CLASSES = ["work", "record"] as const satisfies readonly [
  MutableNotificationClass,
  ...MutableNotificationClass[],
];

// A row exists only when a person has turned something off, so the mute table is empty for
// everyone who has never opened the card.
export const notificationMutes = pgTable(
  "notification_mutes",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    class: text("class", { enum: MUTABLE_NOTIFICATION_CLASSES }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.userId, table.class] }),

    index("notification_mutes_org_user_idx").on(table.organizationId, table.userId),

    // The Drizzle enum above is TypeScript-only; this is the database's own copy of the
    // refusal, so a raw write cannot hide a health notification either (ADD D-6, AC-20).
    check("notification_mutes_class_check", sql`${table.class} in ('work', 'record')`),
  ],
);
