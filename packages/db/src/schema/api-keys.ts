import { randomUUID } from "node:crypto";

import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";

/**
 * One row per minted read credential. The store behind `/api/mcp`. A person mints one
 * with `scripts/mint-api-key.ts` and hands it to their coding agent; the agent presents
 * it and the resolver turns it into an organisation id.
 *
 * Org-scoped, never project-scoped `write_keys` is dual-stamped (`organization_id` and
 * `project_id`). This table is organisation-scoped only, and that asymmetry is
 * deliberate. Do not "restore symmetry" by adding a `project_id` here.
 *
 * A write key addresses one project's ingest. A read credential addresses one
 * organisation's findings: `list_open_fixes` already takes an optional project
 * argument, so a credential-borne project id would silently override or contradict the
 * argument the caller passed. A wrong answer with no error, which is the worst shape a
 * tenancy bug can take. Per-project read scoping is therefore impossible until someone
 * adds the column and makes that decision explicitly, and that is the correct trade for
 * this table.
 *
 * Why it is its own table, not a `WriteKeyKind` member The blast radii are not
 * comparable. A write key is public by construction. It ships in the customer's page
 * source (docs/architecture.md), so a stolen one is junk telemetry in one project. A
 * stolen read credential is every finding, every count and every fix instruction in the
 * organisation. Mechanically, a new kind would also have to satisfy two compile-time
 * pins over `WriteKeyKind` (`write-keys.ts`'s column tuple and `attribution.ts`'s
 * exhaustive `Record`), forcing a meaningless ingest `origin` onto a credential that
 * never ingests anything.
 *
 * Consequently this table copies neither of the two ingest-specific parts of
 * `write_keys`: no `kind` enum column with its `satisfies` pin, and no `project_id`
 * dual stamp.
 *
 * What is deliberately absent No `expires_at`, no `last_used_at`, no
 * `created_by_user_id`. `last_used_at` would put a write on the authentication path. A
 * side effect that can fail, on the one path that must fail closed and stay cheap (the
 * resolver reaches this table on every well-formed presentation, deliberately, because
 * that is what makes revocation live). `created_by_user_id` waits for a session to
 * validate it against; a CLI has none, and an unvalidated actor column is worse than no
 * column. A later nullable add needs no backfill.
 *
 * The row is the tenant proof `resolveApiKeyForRead` takes no tenant context: the
 * presented material IS the tenancy claim. The only things between a presented string
 * and an organisation id are the unique index on `key_hash` and `is null (revoked_at)`
 * in the same predicate. Both are load-bearing security machinery, not query tuning.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    /** The whole scope of this credential. Cascades: a deleted organisation's
     * credentials have nothing left to authenticate against. */
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Operator-supplied label, so a person can tell two agents' keys apart when
     * deciding which one to revoke. */
    name: text("name").notNull(),
    /** SHA-256 hex of the raw material. The deterministic lookup key. The raw material
     * itself is returned once by `mint` and persisted nowhere. */
    keyHash: text("key_hash").notNull(),
    /** The scheme plus six characters of material (`API_KEY_DISPLAY_PREFIX_LENGTH` =
     * 11), for identification only. Unlike `write_keys.key_prefix` this is a fragment
     * of a secret, which is why it is six characters and not twelve. The tail that
     * makes the key usable is never stored. */
    keyPrefix: text("key_prefix").notNull(),
    /** Non-null means revoked. Read by the resolver's `isNull` predicate in the same
     * `where` as the hash lookup, so a revoked credential and an unknown one are
     * indistinguishable by answer and by time. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // The resolver's only index, and a real constraint: 256 bits of randomness makes a
    // collision an error rather than a silent overwrite of another organisation's
    // credential.
    uniqueIndex("api_keys_key_hash_uidx").on(table.keyHash),
    // Every scoped read and mutation names `organization_id` first; this is the index
    // those land on.
    index("api_keys_organization_id_idx").on(table.organizationId),
  ],
);
