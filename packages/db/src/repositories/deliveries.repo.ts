import type { DeliveryStatus, TenantContext } from "@growthmind/shared";
import { and, desc, eq, ne, sql } from "drizzle-orm";

import { deliveries } from "../schema/deliveries";
import { orgCrud } from "./crud";
import type { SignatureHex } from "../signatures/hex";
import type { ScopedDb, ScopedExecutor } from "./types";

export type DeliveryRecord = typeof deliveries.$inferSelect;

export interface ClaimDeliveryInput {
  readonly projectId: string;
  readonly findingId: string;

  readonly signature: SignatureHex;

  readonly channelId: string;
  readonly claimedAt: Date;
}

export type ClaimDeliveryResult =
  | { readonly claimed: true; readonly delivery: DeliveryRecord }
  | { readonly claimed: false; readonly delivery: DeliveryRecord | null };

export interface MarkPostedInput {
  readonly findingId: string;
  readonly channelId: string;
  readonly postedAt: Date;

  readonly messageRef: string | null;
}

export interface MarkFailedInput {
  readonly findingId: string;
  readonly channelId: string;
  readonly failedAt: Date;

  readonly reason: string;
}

export interface DeliveriesRepo {
  claimForPost(input: ClaimDeliveryInput): Promise<ClaimDeliveryResult>;

  markPosted(input: MarkPostedInput): Promise<DeliveryRecord | null>;

  markFailed(input: MarkFailedInput): Promise<DeliveryRecord | null>;

  findFor(findingId: string, channelId: string): Promise<DeliveryRecord | null>;

  findLatestForSignature(
    projectId: string,
    signature: SignatureHex,
  ): Promise<DeliveryRecord | null>;

  listPendingForProject(projectId: string): Promise<DeliveryRecord[]>;
}

export const DELIVERY_CONFLICT_TARGET = [
  deliveries.organizationId,
  deliveries.findingId,
  deliveries.channelId,
];

const RE_CLAIMABLE_STATUS: DeliveryStatus = "failed";

function byTuple(findingId: string, channelId: string) {
  return and(eq(deliveries.findingId, findingId), eq(deliveries.channelId, channelId));
}

export function createDeliveriesRepo(db: ScopedExecutor, ctx: TenantContext): DeliveriesRepo {
  const c = orgCrud(db, ctx, deliveries);

  return {
    async claimForPost(input: ClaimDeliveryInput): Promise<ClaimDeliveryResult> {
      const result = await c.claim(
        {
          projectId: input.projectId,
          findingId: input.findingId,
          signature: input.signature,
          channelId: input.channelId,
          status: "pending",
          claimedAt: input.claimedAt,
          attempts: 1,
        },
        {
          target: DELIVERY_CONFLICT_TARGET,
          setWhere: eq(deliveries.status, RE_CLAIMABLE_STATUS),
          set: {
            status: "pending",
            claimedAt: input.claimedAt,

            attempts: sql`${deliveries.attempts} + 1`,

            failedAt: null,
            failureReason: null,
          },
          fetch: [byTuple(input.findingId, input.channelId)],
        },
      );

      if (result.claimed && result.row) {
        return { claimed: true, delivery: result.row };
      }

      return { claimed: false, delivery: result.row };
    },

    async markPosted(input: MarkPostedInput): Promise<DeliveryRecord | null> {
      return c.update(
        {
          status: "posted",

          postedAt: sql`coalesce(${deliveries.postedAt}, ${input.postedAt})`,
          messageRef: sql`coalesce(${deliveries.messageRef}, ${input.messageRef}::text)`,

          failedAt: null,
          failureReason: null,
        },
        byTuple(input.findingId, input.channelId),
      );
    },

    async markFailed(input: MarkFailedInput): Promise<DeliveryRecord | null> {
      return c.update(
        {
          status: "failed",
          failedAt: input.failedAt,
          failureReason: input.reason,
        },
        byTuple(input.findingId, input.channelId),
        ne(deliveries.status, "posted"),
      );
    },

    async findFor(findingId: string, channelId: string): Promise<DeliveryRecord | null> {
      return c.maybe(byTuple(findingId, channelId));
    },

    async findLatestForSignature(
      projectId: string,
      signature: SignatureHex,
    ): Promise<DeliveryRecord | null> {
      const rows = await c.list({
        where: and(eq(deliveries.projectId, projectId), eq(deliveries.signature, signature)),
        orderBy: [desc(deliveries.claimedAt)],
        limit: 1,
      });

      return rows[0] ?? null;
    },

    async listPendingForProject(projectId: string): Promise<DeliveryRecord[]> {
      return c.list({
        where: and(eq(deliveries.projectId, projectId), eq(deliveries.status, "pending")),
        orderBy: [desc(deliveries.claimedAt)],
      });
    },
  };
}

export interface InteractionPrincipal {
  readonly context: TenantContext;
  readonly findingId: string;
  readonly projectId: string;
  readonly deliveryId: string;
}

const INTERACTION_NOT_IMPLEMENTED =
  "deliveries.repo: resolveDeliveryForInteraction is not implemented";

export function resolveDeliveryForInteraction(
  db: ScopedDb,
  args: { channelId: string; messageRef: string },
): Promise<InteractionPrincipal | null> {
  void db;
  void args;
  throw new Error(INTERACTION_NOT_IMPLEMENTED);
}
