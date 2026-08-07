import type { DigestCadence, Weekday } from "@growthmind/shared";
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { organization } from "./auth";

const DIGEST_CADENCES = ["weekly", "off"] as const satisfies readonly [
  DigestCadence,
  ...DigestCadence[],
];

const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const satisfies readonly [Weekday, ...Weekday[]];

// One row per org, and the primary key is that constraint. Absence is the default (ADD
// D-6): there is no seed row and no backfill, so an organization nobody has configured is
// correctly configured — and the digest's enumeration LEFT JOINs this table for that
// reason.
export const notificationSettings = pgTable("notification_settings", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),

  digestCadence: text("digest_cadence", { enum: DIGEST_CADENCES }).notNull().default("weekly"),

  digestDay: text("digest_day", { enum: WEEKDAYS }).notNull().default("monday"),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});
