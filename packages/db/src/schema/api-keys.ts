import { randomUUID } from "node:crypto";

import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization, user } from "./auth";

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

    // Who minted it. A key reads this org's findings through MCP for as long as it lives, so
    // "who issued this" has to be answerable. Nullable: rows predating the column, and any
    // minted by a non-human principal, name nobody.
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),

    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("api_keys_key_hash_uidx").on(table.keyHash),

    index("api_keys_organization_id_idx").on(table.organizationId),
  ],
);
