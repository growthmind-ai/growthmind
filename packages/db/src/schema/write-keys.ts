import { randomUUID } from "node:crypto";

import type { WriteKeyKind } from "@growthmind/shared";
import { pgTable, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { projects } from "./projects";

const WRITE_KEY_KINDS = ["standard", "simulation"] as const satisfies readonly [
  WriteKeyKind,
  ...WriteKeyKind[],
];

export const writeKeys = pgTable(
  "write_keys",
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
    kind: text("kind", { enum: WRITE_KEY_KINDS }).notNull(),

    keyHash: text("key_hash").notNull(),

    keyPrefix: text("key_prefix").notNull(),

    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("write_keys_key_hash_uidx").on(table.keyHash),
    index("write_keys_organization_id_idx").on(table.organizationId),
    index("write_keys_project_id_idx").on(table.projectId),
  ],
);
