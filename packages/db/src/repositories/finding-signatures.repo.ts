import type { TenantContext } from "@growthmind/shared";
import type { FindingClass } from "@growthmind/core";
import { and, eq, sql } from "drizzle-orm";

import { findingSignatures } from "../schema/finding-signatures";
import type { SignatureHex } from "../signatures/hex";
import type { ScopedDb } from "./types";

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

  carryForward(input: CarryForwardInput): Promise<FindingSignatureRecord | null>;
}

export function createFindingSignaturesRepo(
  db: ScopedDb,
  ctx: TenantContext,
): FindingSignaturesRepo {
  function byTuple(projectId: string, signature: SignatureHex) {
    return and(
      eq(findingSignatures.organizationId, ctx.organizationId),
      eq(findingSignatures.projectId, projectId),
      eq(findingSignatures.signature, signature),
    );
  }

  return {
    async upsertSeen(input: UpsertSeenInput): Promise<FindingSignatureRecord> {
      const [row] = await db
        .insert(findingSignatures)
        .values({
          organizationId: ctx.organizationId,
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
        })
        .onConflictDoUpdate({
          target: [
            findingSignatures.organizationId,
            findingSignatures.projectId,
            findingSignatures.signature,
          ],
          set: {
            timesSeen: sql`${findingSignatures.timesSeen} + 1`,
            lastSeenAt: sql`greatest(${findingSignatures.lastSeenAt}, excluded.last_seen_at)`,
          },
        })
        .returning();

      if (!row) {
        throw new Error("createFindingSignaturesRepo.upsertSeen: upsert returned no row");
      }

      return row;
    },

    async findBySignature(
      projectId: string,
      signature: SignatureHex,
    ): Promise<FindingSignatureRecord | null> {
      const [row] = await db.select().from(findingSignatures).where(byTuple(projectId, signature));

      return row ?? null;
    },

    async markDelivered(
      projectId: string,
      signature: SignatureHex,
      at: Date,
    ): Promise<FindingSignatureRecord | null> {
      const [row] = await db
        .update(findingSignatures)
        .set({ deliveredAt: sql`coalesce(${findingSignatures.deliveredAt}, ${at})` })
        .where(byTuple(projectId, signature))
        .returning();

      return row ?? null;
    },

    async carryForward(input: CarryForwardInput): Promise<FindingSignatureRecord | null> {
      const [oldRow] = await db
        .select()
        .from(findingSignatures)
        .where(byTuple(input.projectId, input.oldSignature));

      if (!oldRow) {
        return null;
      }

      const [row] = await db
        .insert(findingSignatures)
        .values({
          organizationId: ctx.organizationId,
          ...carryForwardValues({
            projectId: input.projectId,
            newSignature: input.newSignature,
            oldRow,
          }),
        })
        .onConflictDoUpdate({
          target: LEDGER_CONFLICT_TARGET,
          set: CARRY_FORWARD_SET,
        })
        .returning();

      if (!row) {
        throw new Error("createFindingSignaturesRepo.carryForward: upsert returned no row");
      }

      return row;
    },
  };
}
