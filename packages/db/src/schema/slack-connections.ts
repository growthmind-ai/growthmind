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

const CONNECTION_HEALTHS = [
  "validating",
  "healthy",
  "failing",
  "disconnected",
] as const satisfies readonly [ConnectionHealth, ...ConnectionHealth[]];

const POST_FAILURE_CODES = [
  "call_failed",
  "rejected",
  "not_authorised",
  "channel_unavailable",
] as const satisfies readonly [PostFailureCode, ...PostFailureCode[]];

const SLACK_CREDENTIAL_AAD_SCOPE = "slack";

export function slackCredentialAad(ctx: TenantContext): string {
  return credentialAad(ctx.organizationId, SLACK_CREDENTIAL_AAD_SCOPE);
}

export const slackConnections = pgTable(
  "slack_connections",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    channelId: text("channel_id").notNull(),

    credentialCiphertext: text("credential_ciphertext").notNull(),

    credentialKeyId: text("credential_key_id").notNull(),
    isActive: boolean("is_active").default(true).notNull(),

    health: text("health", { enum: CONNECTION_HEALTHS }).notNull().default("validating"),
    healthReasonCode: text("health_reason_code", { enum: POST_FAILURE_CODES }),

    healthReasonMessage: text("health_reason_message"),
    healthCheckedAt: timestamp("health_checked_at", { withTimezone: true }),

    connectedByUserId: text("connected_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    connectedAt: timestamp("connected_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("slack_connections_active_org_uidx")
      .on(table.organizationId)
      .where(sql`${table.isActive}`),
    index("slack_connections_organization_id_idx").on(table.organizationId),
  ],
);
