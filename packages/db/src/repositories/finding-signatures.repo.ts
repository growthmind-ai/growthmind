import type { TenantContext } from "@growthmind/shared";
import type { FindingClass } from "@growthmind/core";
import { and, eq, sql } from "drizzle-orm";

import { findingSignatures } from "../schema/finding-signatures";
import { orgCrud } from "./crud";
import type { SignatureHex } from "../signatures/hex";
import type { ScopedExecutor } from "./types";

export type FindingSignatureRecord = typeof findingSignatures.$inferSelect;

export interface UpsertSeenInput {
  readonly projectId: string;
  readonly signature: SignatureHex;
  readonly symptomClass: FindingClass;
  readonly surface: string;
  readonly signatureTupleVersion: number;
  readonly evidenceShapeVersion: number;

  readonly surfaceNormalisationVersion: number | null;
  readonly seenAt: Date;
}

export interface CarryForwardInput {
  readonly projectId: string;
  readonly oldSignature: SignatureHex;
  readonly newSignature: SignatureHex;
}

export function carryForwardValues(params: {
  readonly projectId: string;
  readonly newSignature: SignatureHex;
  readonly oldRow: FindingSignatureRecord;
}): Omit<typeof findingSignatures.$inferInsert, "organizationId"> {
  const { oldRow } = params;

  return {
    projectId: params.projectId,
    signature: params.newSignature,
    symptomClass: oldRow.symptomClass,
    surface: oldRow.surface,
    signatureTupleVersion: oldRow.signatureTupleVersion,
    evidenceShapeVersion: oldRow.evidenceShapeVersion,
    surfaceNormalisationVersion: oldRow.surfaceNormalisationVersion,
    firstSeenAt: oldRow.firstSeenAt,
    lastSeenAt: oldRow.lastSeenAt,
    timesSeen: oldRow.timesSeen,
    deliveredAt: oldRow.deliveredAt,
    dismissedAt: oldRow.dismissedAt,
  };
}

export const LEDGER_CONFLICT_TARGET = [
  findingSignatures.organizationId,
  findingSignatures.projectId,
  findingSignatures.signature,
];

export const CARRY_FORWARD_SET = {
  firstSeenAt: sql`least(${findingSignatures.firstSeenAt}, excluded.first_seen_at)`,
  lastSeenAt: sql`greatest(${findingSignatures.lastSeenAt}, excluded.last_seen_at)`,
  timesSeen: sql`${findingSignatures.timesSeen} + excluded.times_seen`,
  deliveredAt: sql`coalesce(${findingSignatures.deliveredAt}, excluded.delivered_at)`,
  dismissedAt: sql`coalesce(${findingSignatures.dismissedAt}, excluded.dismissed_at)`,
};

export interface FindingSignaturesRepo {
  upsertSeen(input: UpsertSeenInput): Promise<FindingSignatureRecord>;

  findBySignature(
    projectId: string,
    signature: SignatureHex,
  ): Promise<FindingSignatureRecord | null>;

  markDelivered(
    projectId: string,
    signature: SignatureHex,
    at: Date,
  ): Promise<FindingSignatureRecord | null>;

  markDismissed(
    projectId: string,
    signature: SignatureHex,
    at: Date,
  ): Promise<FindingSignatureRecord | null>;

  carryForward(input: CarryForwardInput): Promise<FindingSignatureRecord | null>;
}

function byTuple(projectId: string, signature: SignatureHex) {
  return and(
    eq(findingSignatures.projectId, projectId),
    eq(findingSignatures.signature, signature),
  );
}

export function createFindingSignaturesRepo(
  db: ScopedExecutor,
  ctx: TenantContext,
): FindingSignaturesRepo {
  const c = orgCrud(db, ctx, findingSignatures);

  return {
    async upsertSeen(input: UpsertSeenInput): Promise<FindingSignatureRecord> {
      return c.insertOrFetch(
        {
          projectId: input.projectId,
          signature: input.signature,
          symptomClass: input.symptomClass,
          surface: input.surface,
          signatureTupleVersion: input.signatureTupleVersion,
          evidenceShapeVersion: input.evidenceShapeVersion,
          surfaceNormalisationVersion: input.surfaceNormalisationVersion,
          firstSeenAt: input.seenAt,
          lastSeenAt: input.seenAt,
          timesSeen: 1,
        },
        {
          target: LEDGER_CONFLICT_TARGET,
          set: {
            timesSeen: sql`${findingSignatures.timesSeen} + 1`,
            lastSeenAt: sql`greatest(${findingSignatures.lastSeenAt}, excluded.last_seen_at)`,
          },
          fetch: [byTuple(input.projectId, input.signature)],
        },
      );
    },

    async findBySignature(
      projectId: string,
      signature: SignatureHex,
    ): Promise<FindingSignatureRecord | null> {
      return c.maybe(byTuple(projectId, signature));
    },

    async markDelivered(
      projectId: string,
      signature: SignatureHex,
      at: Date,
    ): Promise<FindingSignatureRecord | null> {
      return c.update(
        { deliveredAt: sql`coalesce(${findingSignatures.deliveredAt}, ${at})` },
        byTuple(projectId, signature),
      );
    },

    async markDismissed(
      projectId: string,
      signature: SignatureHex,
      at: Date,
    ): Promise<FindingSignatureRecord | null> {
      return c.update(
        { dismissedAt: sql`coalesce(${findingSignatures.dismissedAt}, ${at})` },
        byTuple(projectId, signature),
      );
    },

    async carryForward(input: CarryForwardInput): Promise<FindingSignatureRecord | null> {
      const oldRow = await c.maybe(byTuple(input.projectId, input.oldSignature));

      if (!oldRow) {
        return null;
      }

      return c.insertOrFetch(
        carryForwardValues({
          projectId: input.projectId,
          newSignature: input.newSignature,
          oldRow,
        }),
        {
          target: LEDGER_CONFLICT_TARGET,
          set: CARRY_FORWARD_SET,
          fetch: [byTuple(input.projectId, input.newSignature)],
        },
      );
    },
  };
}
