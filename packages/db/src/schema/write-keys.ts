import { randomUUID } from "node:crypto";

import type { WriteKeyKind } from "@growthmind/shared";
import { pgTable, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { projects } from "./projects";

// Drizzle's pg-core enum column needs a literal `[string,...string[]]` tuple type;
// Zod's `writeKeyKindSchema.options` is typed as a mutable array and isn't assignable
// to that shape. This tuple is instead compile-time pinned to @growthmind/shared's
// `WriteKeyKind` via `satisfies`, so a typo'd or stale value here is a compile error.
// Packages/shared's Zod schema stays the single runtime source of truth, and this
// literal is checked against its type, not re-declared free-hand.
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
    // Deliberately denormalized: organizationId is reachable via
    // projects.organizationId, but every domain table in this schema is directly
    // organization-scoped so a scoped read or mutation never needs a join to enforce
    // tenancy. The "no id-only mutation" rule stays mechanically uniform across every
    // repository, with zero exceptions.
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: WRITE_KEY_KINDS }).notNull(),
    // SHA-256 hex of the raw key material. The deterministic lookup key. Raw material
    // itself is never persisted.
    keyHash: text("key_hash").notNull(),
    // First 12 chars of the raw material, for future UI identification only. A
    // truncated prefix of a spoofable-by-design public key, no secrecy cost.
    keyPrefix: text("key_prefix").notNull(),
    // Nullable rotation-ready marker: non-null means revoked.
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("write_keys_key_hash_uidx").on(table.keyHash),
    index("write_keys_organization_id_idx").on(table.organizationId),
    index("write_keys_project_id_idx").on(table.projectId),
  ],
);
