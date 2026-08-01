import { randomUUID } from "node:crypto";

import {
  credentialAad,
  type ConnectionHealth,
  type PostFailureCode,
  type TenantContext,
} from "@growthmind/shared";
import { sql } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization, user } from "./auth";

// Enum tuples compile-pinned to @growthmind/shared's Zod unions (D9), the same
// discipline `project-connections.ts:23-52` uses. packages/shared stays the
// single runtime source of truth — these literals are checked against their
// types, never re-declared free-hand.
const CONNECTION_HEALTHS = [
  "validating",
  "healthy",
  "failing",
  "disconnected",
] as const satisfies readonly [ConnectionHealth, ...ConnectionHealth[]];

// The DELIVERY vocabulary, not the session-source one. A Slack connection fails
// the four ways a post can fail; `source_failure_code`'s members
// (`project_not_found`, `rate_limited`, …) describe pulling events from an
// analytics vendor and would be a borrowed word here. Two of these four —
// `not_authorised` and `channel_unavailable` — are the ones a retry can never
// fix, which is the distinction this column exists to keep durable.
const POST_FAILURE_CODES = [
  "call_failed",
  "rejected",
  "not_authorised",
  "channel_unavailable",
] as const satisfies readonly [PostFailureCode, ...PostFailureCode[]];

/**
 * The AAD scope this table's credential is sealed under (O-008 AD-20).
 *
 * `credentialAad(organizationId, projectId)` takes a PROJECT id as its second
 * argument everywhere else in this repository, because every other credential
 * we hold belongs to a project. This one does not: a Slack connection is
 * ORG-SCOPED and has no project at all, so the literal `"slack"` takes that
 * slot. It is a cross-boundary literal (D9) and therefore has exactly one home
 * — this constant, read by exactly one function.
 */
const SLACK_CREDENTIAL_AAD_SCOPE = "slack";

/**
 * THE ONLY WAY TO BUILD THIS TABLE'S AAD. Seal with it, open with it, and
 * nothing else.
 *
 * ── WHY THIS FUNCTION EXISTS AT ALL (D11) ───────────────────────────────────
 * Whoever writes the Slack encryption call site will be copying
 * `connections.service.ts`, where the second argument to `credentialAad` is a
 * PROJECT ID. An envelope sealed as `credentialAad(orgId, projectId)` writes
 * perfectly: the column is `text`, the insert succeeds, the connection reads
 * back healthy, and the surface says Slack is connected. It then fails at
 * DELIVERY time — `decryptSecret` returns `authentication_failed` because the
 * AAD the opener computes is not the AAD the sealer used — per customer,
 * silently, in a worker nobody is watching, and only for the customers who
 * actually connected Slack. That is a bug with no compile error, no test
 * failure at the write, and no exception at the read.
 *
 * ── HOW THE WRONG CALL IS MADE IMPOSSIBLE RATHER THAN DISCOURAGED ───────────
 * Two properties, both load-bearing:
 *
 *   1. IT TAKES ONE ARGUMENT. There is no second slot for a project id to be
 *      passed into, so the copied-from-PostHog mistake has nowhere to land.
 *   2. THAT ARGUMENT IS A `TenantContext`, NOT A STRING. A project id is a
 *      `string`, so handing one to this function is a COMPILE ERROR rather
 *      than a wrong value that type-checks. The organization id can only come
 *      from the same context the repository scopes its reads by, so the
 *      ciphertext's binding and the row's `organization_id` filter are
 *      physically incapable of disagreeing.
 *
 * Both call sites this sprint builds already hold a `TenantContext`: the route
 * that seals the pasted token, and the delivery composition root that resolves
 * a poster per lane from the lane's own context.
 */
export function slackCredentialAad(ctx: TenantContext): string {
  return credentialAad(ctx.organizationId, SLACK_CREDENTIAL_AAD_SCOPE);
}

/**
 * The organization's delivery channel (O-008 AD-8, AD-20, FR-O9/FR-O10/FR-O13).
 *
 * ── ORG-SCOPED, NOT ACTOR-SCOPED, AND THAT IS THE WHOLE POINT (D1, D2) ──────
 * `organizationId` is stamped DIRECTLY on the row, the same deliberate
 * denormalization `project_connections` and `write_keys` carry. Every read
 * filters on `ctx.organizationId` and nothing else, so a teammate who set
 * nothing up sees the org's connection, and a revocation by any member takes it
 * away from all of them. `connected_by_user_id` records WHO connected it so a
 * test post can say so — it is attribution, and no read may ever narrow by it.
 * A read keyed on the acting user would be the D1 flagship bug: it works for the
 * person who set it up and silently shows every teammate an unconnected org.
 *
 * ── STAMP/FILTER SYMMETRY, ENUMERATED (D2) ──────────────────────────────────
 * Two columns are filtered on: `organization_id` (stamped by the write path
 * from the tenant context) and `is_active` (stamped by its column default, and
 * flipped by the deactivate path). Nothing else is a filter, so nothing else
 * can produce the failure this repository has already shipped once — a read
 * narrowed by a column the write path never sets, matching zero rows, and
 * reading as "no data" rather than as an error. `health` and its three
 * companions are stamped-but-never-filtered: a later read that narrowed by
 * `health` would have to make the write path stamp it first.
 *
 * ── ONE ACTIVE CONNECTION PER ORG, BY CONSTRAINT (D6, EC-O6) ────────────────
 * `slack_connections_active_org_uidx` is UNIQUE on `(organization_id)` WHERE
 * `is_active`, exactly as `project_connections_active_project_uidx` is one
 * table over. Two members connecting at the same moment cannot both win, and
 * the loser learns it from Postgres rather than from a prior read it raced.
 * Deactivated rows STAY — history survives a reconnect, and "an installation
 * whose only connection is deactivated" stays distinguishable from one that
 * never connected.
 *
 * ── THE CREDENTIAL LEAVES BY ONE DOOR, AND NOT THROUGH THIS TABLE'S SUMMARY ─
 * `credential_ciphertext` is the `v1.<keyId>.<iv>.<tag>.<ciphertext>` envelope
 * and NO repository method returns it in a summary; the one named, org-keyed
 * function that opens it is greppable by design. `credential_key_id` is the
 * 8-hex fingerprint of the key that sealed the row, never the key, so a
 * rotation is a migratable event rather than a D12 silent fork. The AAD those
 * two are bound under has exactly one producer: `slackCredentialAad` above.
 */
export const slackConnections = pgTable(
  "slack_connections",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** The delivery address, read by the lane source off THIS ROW and never
     * accepted from a payload (FR-O13). A channel id that can arrive on a
     * message is a way to post one organization's finding into another's
     * channel — reading it from the lane's own row makes that impossible
     * rather than forbidden (D7). */
    channelId: text("channel_id").notNull(),
    /**
     * The AES-256-GCM envelope: `v1.<keyId>.<iv>.<tag>.<ciphertext>`.
     * Self-describing and versioned, so a row written under a retired key is
     * identifiable rather than an opaque decrypt failure. NO repository method
     * returns this column. Sealed and opened under `slackCredentialAad(ctx)`
     * above, and under nothing else.
     */
    credentialCiphertext: text("credential_ciphertext").notNull(),
    /** The first 8 hex chars of `sha256(key)` — a FINGERPRINT, never the key.
     * Makes key rotation a migratable event instead of a D12 fork. */
    credentialKeyId: text("credential_key_id").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    /**
     * Persisted health, the same four states `project_connections` carries.
     *
     * DEFAULTED, NOT CALLER-SUPPLIED, and `validating` is the honest value at
     * insert: pasting a bot token proves nothing about it. The test post is a
     * separate, deliberate step, and it is what moves this column off its
     * default. A default of `healthy` would have this table assert something
     * no code had checked.
     */
    health: text("health", { enum: CONNECTION_HEALTHS }).notNull().default("validating"),
    healthReasonCode: text("health_reason_code", { enum: POST_FAILURE_CODES }),
    /** Plain English, from packages/shared's message table. Never the vendor's
     * own error text. */
    healthReasonMessage: text("health_reason_message"),
    healthCheckedAt: timestamp("health_checked_at", { withTimezone: true }),
    /**
     * ATTRIBUTION ONLY — see the header. `set null`, never cascade: an
     * organization's delivery must outlive the account of whoever set it up.
     * A cascade here would silently switch off a paying customer's findings
     * the day an employee's user row is deleted.
     */
    connectedByUserId: text("connected_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    connectedAt: timestamp("connected_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    // The second-source refusal — see the header. Partial, so deactivated rows
    // are unconstrained and history accumulates freely.
    uniqueIndex("slack_connections_active_org_uidx")
      .on(table.organizationId)
      .where(sql`${table.isActive}`),
    index("slack_connections_organization_id_idx").on(table.organizationId),
  ],
);
