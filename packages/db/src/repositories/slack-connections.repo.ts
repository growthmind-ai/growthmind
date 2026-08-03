// Org-scoped by construction: the factory takes a `TenantContext`, no method accepts an
// organization id, and every read and mutation filters on `ctx.organizationId`. No method
// returns a credential column; `openCredentialForOrg` is the one door, composition root only.
import type { CredentialKey, DecryptResult, TenantContext } from "@growthmind/shared";
import { decryptSecret } from "@growthmind/shared";
import { eq, isNull } from "drizzle-orm";

import { slackConnections, slackCredentialAad } from "../schema/slack-connections";
import { rethrowScrubbed } from "./driver-error";
import { scoped } from "./scope";
import type { ScopedDb } from "./types";

export type SlackConnectionRow = typeof slackConnections.$inferSelect;

export interface SlackConnectionSummary {
  readonly id: string;

  readonly organizationId: string;

  // `null` means a workspace is attached and nothing can be delivered (AD-4) — not "no Slack",
  // which is this whole summary being `null`. Consumers needing an address use `isDeliveryTarget`.
  readonly channelId: string | null;

  // Not a credential, so it may ride in a summary. `null` on the pasted-token path.
  readonly workspaceName: string | null;

  readonly isActive: boolean;

  readonly connectedByUserId: string | null;
  readonly connectedAt: Date;
}

export interface InsertActiveSlackConnectionInput {
  // `null` on the OAuth path, which holds a bot token before it knows the channel;
  // `attachChannel` fills it later. The pasted-token path supplies both at once.
  readonly channelId: string | null;

  // Slack's `team.name`, absent on the pasted-token path and on callers that predate it.
  readonly workspaceName?: string | null;

  readonly credentialCiphertext: string;

  readonly credentialKeyId: string;
  readonly connectedByUserId: string;
  readonly connectedAt: Date;
}

export interface SlackConnectionsRepo {
  getActiveForOrg(): Promise<SlackConnectionSummary | null>;

  insertActive(input: InsertActiveSlackConnectionInput): Promise<SlackConnectionSummary>;

  // Fills the org's own active row: no connection id parameter exists, so one organization
  // cannot name another's. Once-only (see the guard below); `null` means nothing was updated.
  attachChannel(channelId: string): Promise<SlackConnectionSummary | null>;

  // Org-wide revocation, never a DELETE: the row survives so history outlives a reconnect.
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

function rethrowWithoutParameters(error: unknown, secrets: readonly string[]): never {
  rethrowScrubbed(
    error,
    secrets,
    (message, code, constraint) => new SlackConnectionWriteError(message, code, constraint),
  );
}

export function toSlackConnectionSummary(row: SlackConnectionRow): SlackConnectionSummary {
  return {
    id: row.id,
    organizationId: row.organizationId,
    channelId: row.channelId,
    workspaceName: row.workspaceName,
    isActive: row.isActive,
    connectedByUserId: row.connectedByUserId,
    connectedAt: row.connectedAt,
  };
}

export function createSlackConnectionsRepo(db: ScopedDb, ctx: TenantContext): SlackConnectionsRepo {
  const s = scoped(db, ctx);

  const ourActiveRow = () => s.owned(slackConnections, eq(slackConnections.isActive, true));

  return {
    async getActiveForOrg(): Promise<SlackConnectionSummary | null> {
      const row = s.maybe(await db.select().from(slackConnections).where(ourActiveRow()).limit(1));

      return row ? toSlackConnectionSummary(row) : null;
    },

    async insertActive(input: InsertActiveSlackConnectionInput): Promise<SlackConnectionSummary> {
      try {
        const [row] = await db
          .insert(slackConnections)
          .values({
            ...s.stamp,
            channelId: input.channelId,
            // `?? null` so an absent key and an explicit null persist as the same value.
            workspaceName: input.workspaceName ?? null,
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

    async attachChannel(channelId: string): Promise<SlackConnectionSummary | null> {
      // The row is found by this context, never by anything on the request (D7), in one
      // `UPDATE … RETURNING` rather than a read-then-write (D6). `channel_id IS NULL` MAKES
      // THIS A FILL, NOT A RE-POINT, AND DELETING IT REPLAYS THE ORG'S WHOLE BACKLOG: the
      // delivery dedup key is `(organization_id, finding_id, channel_id)`, so moving the
      // channel forks every delivery identity already recorded — every sent finding reads as
      // never sent and the weekly budget resets, silently. No index can refuse an UPDATE, so
      // this clause is the only thing holding that line. Re-pointing needs a migration.
      const row = s.maybe(
        await db
          .update(slackConnections)
          .set({ channelId })
          .where(
            s.owned(
              slackConnections,
              eq(slackConnections.isActive, true),
              isNull(slackConnections.channelId),
            ),
          )
          .returning(),
      );

      return row ? toSlackConnectionSummary(row) : null;
    },

    async deactivate(id: string): Promise<SlackConnectionSummary | null> {
      const row = s.maybe(
        await db
          .update(slackConnections)
          .set({ isActive: false, health: "disconnected" })
          .where(s.owned(slackConnections, eq(slackConnections.id, id)))
          .returning(),
      );

      return row ? toSlackConnectionSummary(row) : null;
    },

    async openCredentialForOrg(key: CredentialKey): Promise<DecryptResult | null> {
      const row = s.maybe(
        await db
          .select({
            ciphertext: slackConnections.credentialCiphertext,
            keyId: slackConnections.credentialKeyId,
          })
          .from(slackConnections)
          .where(ourActiveRow())
          .limit(1),
      );

      if (!row) {
        return null;
      }

      return decryptSecret(row.ciphertext, key, slackCredentialAad(ctx));
    },
  };
}
