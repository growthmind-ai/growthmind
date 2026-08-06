import {
  SLACK_INTERACTION_ACTOR,
  SLACK_INTERACTION_ROLE,
  type DeliveryStatus,
  type TenantContext,
} from "@growthmind/shared";
import { and, desc, eq, gte, lt, ne, sql, type SQL } from "drizzle-orm";

import { organization } from "../schema/auth";
import { deliveries } from "../schema/deliveries";
import { orgCrud } from "./crud";
import { signatureHex, type SignatureHex } from "../signatures/hex";
import type { ScopedDb, ScopedExecutor } from "./types";

export type DeliveryRecord = typeof deliveries.$inferSelect;

export interface ClaimDeliveryInput {
  readonly projectId: string;
  readonly findingId: string;

  readonly signature: SignatureHex;

  readonly channelId: string;
  readonly claimedAt: Date;

  // Claims older than this are abandoned rather than in flight, and may be taken over. The
  // policy lives in `@growthmind/core`; this repository only applies the instant it is given.
  readonly staleClaimsBefore: Date;
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

  // Only claims still in flight. An abandoned one must not read as work in progress, or the
  // lane answers `one_already_open` on every future tick and the org receives nothing again.
  listPendingForProject(projectId: string, staleClaimsBefore: Date): Promise<DeliveryRecord[]>;
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

// A row is takeable when the last attempt FAILED, or when it was claimed and never
// resolved. Without the second arm nothing ever reclaims an abandoned lease. Composed
// through `sql` rather than `or`, which widens to `SQL | undefined` and cannot satisfy the
// non-optional `setWhere` — a claim with no predicate would overwrite a live delivery.
function reclaimable(staleClaimsBefore: Date): SQL {
  return sql`(${eq(deliveries.status, RE_CLAIMABLE_STATUS)} or (${eq(
    deliveries.status,
    "pending",
  )} and ${lt(deliveries.claimedAt, staleClaimsBefore)}))`;
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
          setWhere: reclaimable(input.staleClaimsBefore),
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

    async listPendingForProject(
      projectId: string,
      staleClaimsBefore: Date,
    ): Promise<DeliveryRecord[]> {
      return c.list({
        where: and(
          eq(deliveries.projectId, projectId),
          eq(deliveries.status, "pending"),
          gte(deliveries.claimedAt, staleClaimsBefore),
        ),
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
  readonly signature: SignatureHex;
}

// The pair is a value Growthmind wrote, under a globally unique partial index, so it
// resolves to one organization. Nothing a Slack payload names reaches the context.
export async function resolveDeliveryForInteraction(
  db: ScopedDb,
  args: { channelId: string; messageRef: string },
): Promise<InteractionPrincipal | null> {
  if (args.channelId === "" || args.messageRef === "") {
    return null;
  }

  const [row] = await db
    .select({
      deliveryId: deliveries.id,
      findingId: deliveries.findingId,
      projectId: deliveries.projectId,
      organizationId: deliveries.organizationId,
      organizationName: organization.name,
      signature: deliveries.signature,
    })
    .from(deliveries)
    .innerJoin(organization, eq(deliveries.organizationId, organization.id))
    .where(
      and(eq(deliveries.channelId, args.channelId), eq(deliveries.messageRef, args.messageRef)),
    )
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    context: {
      userId: SLACK_INTERACTION_ACTOR,
      organizationId: row.organizationId,
      organizationName: row.organizationName,
      role: SLACK_INTERACTION_ROLE,
    },
    findingId: row.findingId,
    projectId: row.projectId,
    deliveryId: row.deliveryId,
    signature: signatureHex(row.signature),
  };
}
