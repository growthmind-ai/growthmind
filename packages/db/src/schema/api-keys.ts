import { randomUUID } from "node:crypto";

import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    name: text("name").notNull(),

    keyHash: text("key_hash").notNull(),

    keyPrefix: text("key_prefix").notNull(),

    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("api_keys_key_hash_uidx").on(table.keyHash),

    index("api_keys_organization_id_idx").on(table.organizationId),
  ],
);
