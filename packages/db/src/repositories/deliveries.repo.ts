import type { DeliveryStatus, TenantContext } from "@growthmind/shared";
import { and, desc, eq, ne, sql } from "drizzle-orm";

import { deliveries } from "../schema/deliveries";
import { scoped } from "./scope";
import type { SignatureHex } from "../signatures/hex";
import type { ScopedDb } from "./types";

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

export function createDeliveriesRepo(db: ScopedDb, ctx: TenantContext): DeliveriesRepo {
  const s = scoped(db, ctx);

  function byTuple(findingId: string, channelId: string) {
    return s.owned(
      deliveries,
      eq(deliveries.findingId, findingId),
      eq(deliveries.channelId, channelId),
    );
  }

  return {
    async claimForPost(input: ClaimDeliveryInput): Promise<ClaimDeliveryResult> {
      const [claimed] = await db
        .insert(deliveries)
        .values({
          ...s.stamp,
          projectId: input.projectId,
          findingId: input.findingId,
          signature: input.signature,
          channelId: input.channelId,
          status: "pending",
          claimedAt: input.claimedAt,
          attempts: 1,
        })
        .onConflictDoUpdate({
          target: DELIVERY_CONFLICT_TARGET,

          setWhere: eq(deliveries.status, RE_CLAIMABLE_STATUS),
          set: {
            status: "pending",
            claimedAt: input.claimedAt,

            attempts: sql`${deliveries.attempts} + 1`,

            failedAt: null,
            failureReason: null,
          },
        })
        .returning();

      if (claimed) {
        return { claimed: true, delivery: claimed };
      }

      const existing = s.maybe(
        await db
          .select()
          .from(deliveries)
          .where(byTuple(input.findingId, input.channelId))
          .limit(1),
      );

      return { claimed: false, delivery: existing };
    },

    async markPosted(input: MarkPostedInput): Promise<DeliveryRecord | null> {
      return s.maybe(
        await db
          .update(deliveries)
          .set({
            status: "posted",

            postedAt: sql`coalesce(${deliveries.postedAt}, ${input.postedAt})`,
            messageRef: sql`coalesce(${deliveries.messageRef}, ${input.messageRef}::text)`,

            failedAt: null,
            failureReason: null,
          })
          .where(byTuple(input.findingId, input.channelId))
          .returning(),
      );
    },

    async markFailed(input: MarkFailedInput): Promise<DeliveryRecord | null> {
      return s.maybe(
        await db
          .update(deliveries)
          .set({
            status: "failed",
            failedAt: input.failedAt,
            failureReason: input.reason,
          })
          .where(and(byTuple(input.findingId, input.channelId), ne(deliveries.status, "posted")))
          .returning(),
      );
    },

    async findFor(findingId: string, channelId: string): Promise<DeliveryRecord | null> {
      return s.maybe(
        await db.select().from(deliveries).where(byTuple(findingId, channelId)).limit(1),
      );
    },

    async findLatestForSignature(
      projectId: string,
      signature: SignatureHex,
    ): Promise<DeliveryRecord | null> {
      return s.maybe(
        await db
          .select()
          .from(deliveries)
          .where(
            s.owned(
              deliveries,
              eq(deliveries.projectId, projectId),
              eq(deliveries.signature, signature),
            ),
          )
          .orderBy(desc(deliveries.claimedAt))
          .limit(1),
      );
    },

    async listPendingForProject(projectId: string): Promise<DeliveryRecord[]> {
      return db
        .select()
        .from(deliveries)
        .where(
          s.owned(
            deliveries,
            eq(deliveries.projectId, projectId),
            eq(deliveries.status, "pending"),
          ),
        )
        .orderBy(desc(deliveries.claimedAt));
    },
  };
}
