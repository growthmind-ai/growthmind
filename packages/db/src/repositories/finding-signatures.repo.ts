// Repository for the `finding_signatures` table: org-scoped at construction, no
// organization id parameter, mutations keyed on `(organization_id, project_id,
// signature)`. There is no `updateById`.
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
  /** `null` = written before versions were recorded ( precedent). */
  readonly surfaceNormalisationVersion: number | null;
  readonly seenAt: Date;
}

export interface CarryForwardInput {
  readonly projectId: string;
  readonly oldSignature: SignatureHex;
  readonly newSignature: SignatureHex;
}

/**
 * The one definition of carry-forward.
 *
 * 's carry-forward runs from two call sites. This repository (over a `ScopedDb`) and
 * `recordAncestry`'s transaction body (over a `tx` handle, which `ScopedDb`'s union
 * cannot accept). They used to be two hand-copied ~40-line upserts, which is how the
 * tested copy and the shipped copy came to differ. The query builder still differs (it
 * must), but the insert values and the conflict-update clause (the actual semantics)
 * are built here, once, and both call sites pass them through.
 *
 * `organization_id` is deliberately not a parameter and not returned (
 * `no-org-param.test.ts`): each call site spreads this object and names
 * `ctx.organizationId` literally beside it, so the org filter is never something a
 * helper could be handed wrong.
 */
export function carryForwardValues(params: {
  readonly projectId: string;
  readonly newSignature: SignatureHex;
  readonly oldRow: FindingSignatureRecord;
}): Omit<typeof findingSignatures.$inferInsert, "organizationId"> {
  const { oldRow } = params;
  // When no row exists yet for the new signature, these values are the new row: the old
  // row's provenance and counters carried over wholesale, so the new row is a fully
  // valid ledger row and never a partial one.
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

/** The unique-index tuple every ledger upsert conflicts on. */
export const LEDGER_CONFLICT_TARGET = [
  findingSignatures.organizationId,
  findingSignatures.projectId,
  findingSignatures.signature,
];

/**
 * The conflict-update for carry-forward, per: when a row for the new signature already
 * exists (the common case. The pipeline recorded it naturally before the re-key was
 * noticed), the two histories combine. `coalesce(existing, old)` on `delivered_at` /
 * `dismissed_at` means a carry-forward can only ever add suppression, never clear it.
 * The old row is never touched. It stays in place as the audit trail.
 */
export const CARRY_FORWARD_SET = {
  firstSeenAt: sql`least(${findingSignatures.firstSeenAt}, excluded.first_seen_at)`,
  lastSeenAt: sql`greatest(${findingSignatures.lastSeenAt}, excluded.last_seen_at)`,
  timesSeen: sql`${findingSignatures.timesSeen} + excluded.times_seen`,
  deliveredAt: sql`coalesce(${findingSignatures.deliveredAt}, excluded.delivered_at)`,
  dismissedAt: sql`coalesce(${findingSignatures.dismissedAt}, excluded.dismissed_at)`,
};

export interface FindingSignaturesRepo {
  /**
   * `ON CONFLICT (organization_id, project_id, signature) DO UPDATE`, atomic in SQL:
   * `times_seen` increments in SQL, `last_seen_at` takes `greatest` so an
   * out-of-order replay never moves the watermark backwards, and
   * `delivered_at`/`dismissed_at`/`first_seen_at` are absent from the `set` clause. A
   * re-record must never clear a delivery or a dismissal.
   */
  upsertSeen(input: UpsertSeenInput): Promise<FindingSignatureRecord>;
  /** Org-filtered lookup by signature, `null` for a foreign org. */
  findBySignature(
    projectId: string,
    signature: SignatureHex,
  ): Promise<FindingSignatureRecord | null>;
  /**
   * `delivered_at = coalesce(delivered_at, $at)`, a delivery replay never moves the
   * first-delivery instant. Returns `null` for a foreign org's signature.
   */
  markDelivered(
    projectId: string,
    signature: SignatureHex,
    at: Date,
  ): Promise<FindingSignatureRecord | null>;
  /**
   * : carries the old ledger row's state forward onto the new signature by upsert,
   * `first_seen_at = least`, `times_seen = existing + old.times_seen`,
   * `delivered_at = coalesce(existing.delivered_at, old.delivered_at)`, `dismissed_at =
   * coalesce(existing.dismissed_at, old.dismissed_at)`. The old row is left in place,
   * untouched, as the audit trail.
   *
   * Returns `null` when the old signature has no ledger row in this org/project scope.
   * That is a legitimate degenerate case, not an error: a version-bump ancestry edge
   * can legally be drawn before any candidate under the old identity was ever seen
   * here, and there is simply nothing to carry. `recordAncestry`'s in-transaction copy
   * of this operation treats it the same way. The two agreeing is the point of review;
   * they used to disagree (this method threw, the service no-op'd) while only this,
   * uncalled, copy was tested.
   */
  carryForward(input: CarryForwardInput): Promise<FindingSignatureRecord | null>;
}

export function createFindingSignaturesRepo(
  db: ScopedDb,
  ctx: TenantContext,
): FindingSignaturesRepo {
  /** Scoped by the full unique-index tuple, never by primary key alone (Multi-tenancy
   * point 3: no id-only mutation path exists on this table). */
  function byTuple(projectId: string, signature: SignatureHex) {
    return and(
      eq(findingSignatures.organizationId, ctx.organizationId),
      eq(findingSignatures.projectId, projectId),
      eq(findingSignatures.signature, signature),
    );
  }

  return {
    async upsertSeen(input: UpsertSeenInput): Promise<FindingSignatureRecord> {
      // the atomic upsert: `times_seen` increments IN SQL (never read-then-write),
      // `last_seen_at` takes `greatest` so an out-of-order replay can never move
      // the watermark backwards, and `delivered_at` / `dismissed_at` / `first_seen_at`
      // are absent from the `set` clause. The single most dangerous line in the sprint:
      // a re-record must never clear a delivery or a dismissal.
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
      // `coalesce(delivered_at, $at)`, a delivery replay never moves the first-delivery
      // instant.
      const [row] = await db
        .update(findingSignatures)
        .set({ deliveredAt: sql`coalesce(${findingSignatures.deliveredAt}, ${at})` })
        .where(byTuple(projectId, signature))
        .returning();

      return row ?? null;
    },

    async carryForward(input: CarryForwardInput): Promise<FindingSignatureRecord | null> {
      // Add: reads the old row's state under this org/project scope (never a
      // foreign org's row. A foreign context finds nothing here and the caller's
      // transaction has nothing to carry).
      const [oldRow] = await db
        .select()
        .from(findingSignatures)
        .where(byTuple(input.projectId, input.oldSignature));

      if (!oldRow) {
        // Nothing to carry, the edge stands alone and the new signature starts its own
        // ledger history the ordinary way via `recordSignature`. See the interface doc
        // for why this is a `null` and not a throw.
        return null;
      }

      // Values and conflict-update come from the one shared definition above, the same
      // clauses `recordAncestry` passes to its `tx`.
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
