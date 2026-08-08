import { randomUUID } from "node:crypto";

import { SLACK_HEALTH_ALERT_COOLDOWN_SECONDS } from "@growthmind/core";
import type {
  CredentialKey,
  DecryptResult,
  PostFailureCode,
  TenantContext,
} from "@growthmind/shared";
import {
  buildSlackDisconnectedDedupKey,
  decryptSecret,
  isDeliveryAddress,
  memberUserId,
  NON_ADDRESS_VALUES,
  NOTIFICATION_RESCUE_TASK,
  TRIMMED_WHITESPACE,
} from "@growthmind/shared";
import { and, eq, inArray, isNotNull, isNull, ne, notInArray, or, sql } from "drizzle-orm";

import { enqueueJob } from "../jobs/enqueue";
import { publishLive } from "../live/publish";
import { emitNotification } from "../notifications/emit";
import { slackConnections, slackCredentialAad } from "../schema/slack-connections";
import { isDeliveryTarget } from "../services/delivery-channel-guard";
import { inTransaction, orgCrud } from "./crud";
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

  // No `connectedByUserId`: the actor is the context's, stamped below from `memberUserId`.
  // A caller-supplied one is a second copy of a fact this repository already holds, and the
  // copy is what would carry a machine actor's synthetic id into a `user.id` column.
  readonly connectedAt: Date;
}

// ADD D-3: `reasonMessage` is stored and never rendered — the CODE is what a sentence is
// built from.
export interface RecordSlackHealthInput {
  readonly health: "healthy" | "failing";
  readonly reasonCode: PostFailureCode | null;
  readonly reasonMessage: string | null;
  readonly checkedAt: Date;
}

export type SlackHealthTransition = "entered_failing" | "recovered" | "none";

export interface SlackConnectionsRepo {
  getActiveForOrg(): Promise<SlackConnectionSummary | null>;

  insertActive(input: InsertActiveSlackConnectionInput): Promise<SlackConnectionSummary>;

  // Both health edges in one conditional update whose returned row is the gate (D-3):
  // entering failing emits the alert, recovering enqueues the rescue, and a repeat of
  // either state refreshes the badge columns without telling anyone twice.
  recordHealth(input: RecordSlackHealthInput): Promise<SlackHealthTransition>;

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

  // Where a finding gets delivered is an organization's setting, not the connector's, so the
  // teammate mid-setup in another tab sees it land too (D1). OAuth finishes on a redirect no
  // open tab made, which is why this cannot live in the route.
  async function announce(): Promise<void> {
    await publishLive(db, { organizationId: ctx.organizationId, topic: "first_run" });
  }

  // A write that matched no row changed nothing on screen, so it is not worth a refresh (D3).
  async function announced(
    row: SlackConnectionSummary | null,
  ): Promise<SlackConnectionSummary | null> {
    if (row === null) {
      return null;
    }

    await announce();

    return row;
  }

  // ADD D-4 producer 1, inside the write so every future caller inherits it. The jobKey
  // collapses repeated triggers; a summary with no address queues nothing because there is
  // still nothing to deliver through.
  async function rescueQueued(
    executor: ScopedExecutor,
    summary: SlackConnectionSummary | null,
  ): Promise<SlackConnectionSummary | null> {
    if (summary !== null && isDeliveryTarget(summary)) {
      await enqueueJob(executor, {
        task: NOTIFICATION_RESCUE_TASK,
        payload: { organizationId: ctx.organizationId },
        jobKey: `${NOTIFICATION_RESCUE_TASK}:${ctx.organizationId}`,
      });
    }

    return summary;
  }

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
          connectedByUserId: memberUserId(ctx),
          connectedAt: input.connectedAt,
        });

        await rescueQueued(db, toSlackConnectionSummary(row));
        await announce();

        return toSlackConnectionSummary(row);
      } catch (error) {
        rethrowWithoutParameters(error, [input.credentialCiphertext, input.credentialKeyId]);
      }
    },

    async recordHealth(input: RecordSlackHealthInput): Promise<SlackHealthTransition> {
      return inTransaction(db, async (tx) => {
        const t = orgCrud(tx, ctx, slackConnections);

        if (input.health === "failing") {
          const entered = await t.update(
            {
              health: "failing",
              healthReasonCode: input.reasonCode,
              healthReasonMessage: input.reasonMessage,
              healthCheckedAt: input.checkedAt,
            },
            activeRow(),
            ne(slackConnections.health, "failing"),
          );

          if (entered === null) {
            // The badge stays truthful even when nobody is told.
            await t.update(
              {
                healthReasonCode: input.reasonCode,
                healthReasonMessage: input.reasonMessage,
                healthCheckedAt: input.checkedAt,
              },
              activeRow(),
            );

            return "none";
          }

          await emitNotification(tx, ctx.organizationId, {
            type: "slack_disconnected",
            subjectKind: "slack_connection",
            subjectId: entered.id,
            actorUserId: null,
            payload: { type: "slack_disconnected", v: 1 },
            dedupKey: buildSlackDisconnectedDedupKey(randomUUID()),
            slack: { kind: "owed" },
            cooldownSeconds: SLACK_HEALTH_ALERT_COOLDOWN_SECONDS,
          });

          return "entered_failing";
        }

        const recovered = await t.update(
          {
            health: "healthy",
            healthReasonCode: null,
            healthReasonMessage: null,
            healthCheckedAt: input.checkedAt,
          },
          activeRow(),
          eq(slackConnections.health, "failing"),
        );

        if (recovered === null) {
          // `validating → healthy` is not a repair, so nothing is enqueued for it.
          await t.update(
            {
              health: "healthy",
              healthReasonCode: null,
              healthReasonMessage: null,
              healthCheckedAt: input.checkedAt,
            },
            activeRow(),
          );

          return "none";
        }

        // Unlike the connection writes, recovery queues without the delivery-target gate:
        // the row that just left `failing` was being posted to, and the sweep is cheap.
        await enqueueJob(tx, {
          task: NOTIFICATION_RESCUE_TASK,
          payload: { organizationId: ctx.organizationId },
          jobKey: `${NOTIFICATION_RESCUE_TASK}:${ctx.organizationId}`,
        });

        return "recovered";
      });
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

      return announced(await rescueQueued(db, row ? toSlackConnectionSummary(row) : null));
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

      return announced(await rescueQueued(db, row ? toSlackConnectionSummary(row) : null));
    },

    async deactivate(id: string): Promise<SlackConnectionSummary | null> {
      const row = await c.update(
        { isActive: false, health: "disconnected" },
        eq(slackConnections.id, id),
      );

      return announced(row ? toSlackConnectionSummary(row) : null);
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
