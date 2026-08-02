import type { CredentialKey, DecryptResult, TenantContext } from "@growthmind/shared";
import { decryptSecret } from "@growthmind/shared";
import { and, eq } from "drizzle-orm";

import { slackConnections, slackCredentialAad } from "../schema/slack-connections";
import type { ScopedDb } from "./types";

export type SlackConnectionRow = typeof slackConnections.$inferSelect;

export interface SlackConnectionSummary {
  readonly id: string;

  readonly organizationId: string;

  readonly channelId: string;
  readonly isActive: boolean;

  readonly connectedByUserId: string | null;
  readonly connectedAt: Date;
}

export interface InsertActiveSlackConnectionInput {
  readonly channelId: string;

  readonly credentialCiphertext: string;

  readonly credentialKeyId: string;
  readonly connectedByUserId: string;
  readonly connectedAt: Date;
}

export interface SlackConnectionsRepo {
  getActiveForOrg(): Promise<SlackConnectionSummary | null>;

  insertActive(input: InsertActiveSlackConnectionInput): Promise<SlackConnectionSummary>;

  deactivate(id: string): Promise<SlackConnectionSummary | null>;

  openCredentialForOrg(key: CredentialKey): Promise<DecryptResult | null>;
}

export class SlackConnectionWriteError extends Error {
  readonly code: string | null;
  readonly constraint: string | null;

  constructor(message: string, code: string | null, constraint: string | null) {
    super(message);
    this.name = "SlackConnectionWriteError";
    this.code = code;
    this.constraint = constraint;
  }
}

interface DriverErrorFields {
  message?: unknown;
  code?: unknown;
  constraint?: unknown;
}

function readDriverFields(error: unknown): DriverErrorFields {
  const cause = (error as { cause?: unknown } | null | undefined)?.cause;
  const candidate = (cause ?? error) as DriverErrorFields | null | undefined;
  return candidate ?? {};
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function rethrowWithoutParameters(error: unknown, secrets: readonly string[]): never {
  const fields = readDriverFields(error);
  const driverMessage =
    asStringOrNull(fields.message) ??
    (error instanceof Error ? error.message : String(error)) ??
    "database write refused";

  let scrubbed = driverMessage;
  for (const secret of secrets) {
    if (secret.length > 0) {
      scrubbed = scrubbed.split(secret).join("[redacted]");
    }
  }

  throw new SlackConnectionWriteError(
    scrubbed,
    asStringOrNull(fields.code),
    asStringOrNull(fields.constraint),
  );
}

export function toSlackConnectionSummary(row: SlackConnectionRow): SlackConnectionSummary {
  return {
    id: row.id,
    organizationId: row.organizationId,
    channelId: row.channelId,
    isActive: row.isActive,
    connectedByUserId: row.connectedByUserId,
    connectedAt: row.connectedAt,
  };
}

export function createSlackConnectionsRepo(db: ScopedDb, ctx: TenantContext): SlackConnectionsRepo {
  return {
    async getActiveForOrg(): Promise<SlackConnectionSummary | null> {
      const [row] = await db
        .select()
        .from(slackConnections)
        .where(
          and(
            eq(slackConnections.organizationId, ctx.organizationId),
            eq(slackConnections.isActive, true),
          ),
        )
        .limit(1);

      return row ? toSlackConnectionSummary(row) : null;
    },

    async insertActive(input: InsertActiveSlackConnectionInput): Promise<SlackConnectionSummary> {
      try {
        const [row] = await db
          .insert(slackConnections)
          .values({
            organizationId: ctx.organizationId,
            channelId: input.channelId,
            credentialCiphertext: input.credentialCiphertext,
            credentialKeyId: input.credentialKeyId,
            isActive: true,
            connectedByUserId: input.connectedByUserId,
            connectedAt: input.connectedAt,
          })
          .returning();

        if (!row) {
          throw new SlackConnectionWriteError("insertActive: insert returned no row", null, null);
        }

        return toSlackConnectionSummary(row);
      } catch (error) {
        if (error instanceof SlackConnectionWriteError) {
          throw error;
        }
        rethrowWithoutParameters(error, [input.credentialCiphertext, input.credentialKeyId]);
      }
    },

    async deactivate(id: string): Promise<SlackConnectionSummary | null> {
      const [row] = await db
        .update(slackConnections)
        .set({ isActive: false, health: "disconnected" })
        .where(
          and(eq(slackConnections.organizationId, ctx.organizationId), eq(slackConnections.id, id)),
        )
        .returning();

      return row ? toSlackConnectionSummary(row) : null;
    },

    async openCredentialForOrg(key: CredentialKey): Promise<DecryptResult | null> {
      const [row] = await db
        .select({
          ciphertext: slackConnections.credentialCiphertext,
          keyId: slackConnections.credentialKeyId,
        })
        .from(slackConnections)
        .where(
          and(
            eq(slackConnections.organizationId, ctx.organizationId),
            eq(slackConnections.isActive, true),
          ),
        )
        .limit(1);

      if (!row) {
        return null;
      }

      return decryptSecret(row.ciphertext, key, slackCredentialAad(ctx));
    },
  };
}
