import type { CredentialKey, DecryptResult, TenantContext } from "@growthmind/shared";
import {
  decryptSecret,
  isDeliveryAddress,
  NON_ADDRESS_VALUES,
  TRIMMED_WHITESPACE,
} from "@growthmind/shared";
import { and, eq, inArray, isNotNull, isNull, ne, notInArray, or, sql } from "drizzle-orm";

import { slackConnections, slackCredentialAad } from "../schema/slack-connections";
import { orgCrud } from "./crud";
import { RepoWriteError, rethrowScrubbed } from "./driver-error";
import type { ScopedExecutor } from "./types";

export type SlackConnectionRow = typeof slackConnections.$inferSelect;

export interface SlackConnectionSummary {
  readonly id: string;

  readonly organizationId: string;

  // `null` means a workspace is attached and nothing can be delivered (AD-4) — not "no Slack",
  // which is this whole summary being `null`. Consumers needing an address use `isDeliveryTarget`.
  readonly channelId: string | null;

  // What a founder is shown in place of the id, which they cannot recognise. `null`
  // on the pasted-token path and on rows written before the column existed.
  readonly channelName: string | null;

  // Not a credential, so it may ride in a summary. `null` on the pasted-token path.
  readonly workspaceName: string | null;

  readonly isActive: boolean;

  // `null` until the address has moved. Delivery reads it as "send nothing older than this".
  readonly deliveryCutoverAt: Date | null;

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
  attachChannel(
    channelId: string,
    channelName: string | null,
  ): Promise<SlackConnectionSummary | null>;

  // Moves an address already set, which `attachChannel` refuses. `null` = nothing matched:
  // no active row, no address to move, or it is already the channel asked for.
  repointChannel(input: RepointChannelInput): Promise<SlackConnectionSummary | null>;

  // Org-wide revocation, never a DELETE: the row survives so history outlives a reconnect.
  deactivate(id: string): Promise<SlackConnectionSummary | null>;

  openCredentialForOrg(key: CredentialKey): Promise<DecryptResult | null>;
}

export interface RepointChannelInput {
  readonly channelId: string;
  readonly channelName: string | null;

  // Same statement as the address: a gap leaves the new channel live with no cutover.
  readonly cutoverAt: Date;
}

export class SlackConnectionWriteError extends RepoWriteError {}

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
    channelName: row.channelName,
    workspaceName: row.workspaceName,
    isActive: row.isActive,
    deliveryCutoverAt: row.deliveryCutoverAt,
    connectedByUserId: row.connectedByUserId,
    connectedAt: row.connectedAt,
  };
}

const activeRow = () => eq(slackConnections.isActive, true);

// `isDeliveryAddress` inverted, in SQL, over the shared list — and over the shared TRIM
// SET, because one-argument `btrim` removes only U+0020 and would disagree on a tab.
const noAddressYet = () =>
  or(
    isNull(slackConnections.channelId),
    inArray(sql`lower(btrim(${slackConnections.channelId}, ${TRIMMED_WHITESPACE}))`, [
      ...NON_ADDRESS_VALUES,
    ]),
  );

// Not `not(noAddressYet())`: NULL in a negated IN is NULL, which a WHERE discards.
const addressAlready = () =>
  and(
    isNotNull(slackConnections.channelId),
    notInArray(sql`lower(btrim(${slackConnections.channelId}, ${TRIMMED_WHITESPACE}))`, [
      ...NON_ADDRESS_VALUES,
    ]),
  );

export function createSlackConnectionsRepo(
  db: ScopedExecutor,
  ctx: TenantContext,
): SlackConnectionsRepo {
  const c = orgCrud(db, ctx, slackConnections);

  return {
    async getActiveForOrg(): Promise<SlackConnectionSummary | null> {
      const row = await c.maybe(activeRow());

      return row ? toSlackConnectionSummary(row) : null;
    },

    async insertActive(input: InsertActiveSlackConnectionInput): Promise<SlackConnectionSummary> {
      try {
        const row = await c.insert({
          channelId: input.channelId,
          workspaceName: input.workspaceName ?? null,
          credentialCiphertext: input.credentialCiphertext,
          credentialKeyId: input.credentialKeyId,
          isActive: true,
          connectedByUserId: input.connectedByUserId,
          connectedAt: input.connectedAt,
        });

        return toSlackConnectionSummary(row);
      } catch (error) {
        rethrowWithoutParameters(error, [input.credentialCiphertext, input.credentialKeyId]);
      }
    },

    async attachChannel(
      channelId: string,
      channelName: string | null,
    ): Promise<SlackConnectionSummary | null> {
      // The guard decides what may be FILLED; this decides what may be WRITTEN.
      if (!isDeliveryAddress(channelId)) {
        return null;
      }

      // A FILL, NEVER A RE-POINT: moving a chosen channel forks every recorded delivery
      // identity. Filling a sentinel forks nothing; moving is `repointChannel`'s job.
      const row = await c.update({ channelId, channelName }, activeRow(), noAddressYet());

      return row ? toSlackConnectionSummary(row) : null;
    },

    async repointChannel(input: RepointChannelInput): Promise<SlackConnectionSummary | null> {
      if (!isDeliveryAddress(input.channelId)) {
        return null;
      }

      // `ne`: a cutover stamped for a no-op move suppresses every undelivered finding.
      const row = await c.update(
        {
          channelId: input.channelId,
          channelName: input.channelName,
          deliveryCutoverAt: input.cutoverAt,
        },
        activeRow(),
        addressAlready(),
        ne(slackConnections.channelId, input.channelId),
      );

      return row ? toSlackConnectionSummary(row) : null;
    },

    async deactivate(id: string): Promise<SlackConnectionSummary | null> {
      const row = await c.update(
        { isActive: false, health: "disconnected" },
        eq(slackConnections.id, id),
      );

      return row ? toSlackConnectionSummary(row) : null;
    },

    async openCredentialForOrg(key: CredentialKey): Promise<DecryptResult | null> {
      const row = await c.maybe(activeRow());

      if (!row) {
        return null;
      }

      return decryptSecret(row.credentialCiphertext, key, slackCredentialAad(ctx));
    },
  };
}
