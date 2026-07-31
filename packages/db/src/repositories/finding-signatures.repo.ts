// Repository for the `finding_signatures` table (O-006 ADD §2 D-9, D-10;
// §5 Wave 4). D-B: org-scoped at construction, no organization id parameter,
// mutations keyed on `(organization_id, project_id, signature)` — there is
// no `updateById`.
//
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
  /** `null` = written before versions were recorded (ES-14 precedent). */
  readonly surfaceNormalisationVersion: number | null;
  readonly seenAt: Date;
}

export interface CarryForwardInput {
  readonly projectId: string;
  readonly oldSignature: SignatureHex;
  readonly newSignature: SignatureHex;
}

export interface FindingSignaturesRepo {
  /**
   * `ON CONFLICT (organization_id, project_id, signature) DO UPDATE` —
   * atomic in SQL (D-9, D6): `times_seen` increments in SQL, `last_seen_at`
   * takes `greatest(...)` so an out-of-order replay never moves the
   * watermark backwards, and `delivered_at`/`dismissed_at`/`first_seen_at`
   * are ABSENT from the `set` clause — a re-record must never clear a
   * delivery or a dismissal.
   */
  upsertSeen(input: UpsertSeenInput): Promise<FindingSignatureRecord>;
  /** Org-filtered lookup by signature — `null` for a foreign org. */
  findBySignature(projectId: string, signature: SignatureHex): Promise<FindingSignatureRecord | null>;
  /**
   * `delivered_at = coalesce(delivered_at, $at)` — a delivery replay never
   * moves the first-delivery instant (D4). Returns `null` for a foreign
   * org's signature.
   */
  markDelivered(
    projectId: string,
    signature: SignatureHex,
    at: Date,
  ): Promise<FindingSignatureRecord | null>;
  /**
   * D-3(a): carries the OLD ledger row's state forward onto the NEW
   * signature by upsert — `first_seen_at = least(...)`,
   * `times_seen = existing + old.times_seen`,
   * `delivered_at = coalesce(existing.delivered_at, old.delivered_at)`,
   * `dismissed_at = coalesce(existing.dismissed_at, old.dismissed_at)`. The
   * old row is left in place, untouched, as the audit trail. Called from
   * inside `recordAncestry`'s transaction (D-3a, D-8) — never on its own.
   */
  carryForward(input: CarryForwardInput): Promise<FindingSignatureRecord>;
}

export function createFindingSignaturesRepo(
  db: ScopedDb,
  ctx: TenantContext,
): FindingSignaturesRepo {
  /** Scoped by the full unique-index tuple — never by primary key alone
   * (§6 Multi-tenancy point 3: no id-only mutation path exists on this
   * table). */
  function byTuple(projectId: string, signature: SignatureHex) {
    return and(
      eq(findingSignatures.organizationId, ctx.organizationId),
      eq(findingSignatures.projectId, projectId),
      eq(findingSignatures.signature, signature),
    );
  }

  return {
    async upsertSeen(input: UpsertSeenInput): Promise<FindingSignatureRecord> {
      // D-9's atomic upsert: `times_seen` increments IN SQL (D6, never
      // read-then-write), `last_seen_at` takes `greatest(...)` so an
      // out-of-order replay can never move the watermark backwards (D4),
      // and `delivered_at` / `dismissed_at` / `first_seen_at` are ABSENT
      // from the `set` clause — the single most dangerous line in the
      // sprint: a re-record must never clear a delivery or a dismissal.
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
      const [row] = await db
        .select()
        .from(findingSignatures)
        .where(byTuple(projectId, signature));

      return row ?? null;
    },

    async markDelivered(
      projectId: string,
      signature: SignatureHex,
      at: Date,
    ): Promise<FindingSignatureRecord | null> {
      // `coalesce(delivered_at, $at)` — a delivery replay never moves the
      // first-delivery instant (D4).
      const [row] = await db
        .update(findingSignatures)
        .set({ deliveredAt: sql`coalesce(${findingSignatures.deliveredAt}, ${at})` })
        .where(byTuple(projectId, signature))
        .returning();

      return row ?? null;
    },

    async carryForward(input: CarryForwardInput): Promise<FindingSignatureRecord> {
      // ADD D-3(a): reads the OLD row's state under THIS org/project scope
      // (never a foreign org's row — a foreign context finds nothing here
      // and the caller's transaction has nothing to carry).
      const [oldRow] = await db
        .select()
        .from(findingSignatures)
        .where(byTuple(input.projectId, input.oldSignature));

      if (!oldRow) {
        throw new Error(
          "createFindingSignaturesRepo.carryForward: no ledger row found for the old signature in this org/project scope",
        );
      }

      // Upsert onto the NEW signature: when no row exists yet for it, the
      // insert values ARE the old row's provenance and counters carried
      // over wholesale — the new row must be a fully valid ledger row, not
      // a partial one. When a row already exists (the common case: the
      // pipeline already recorded the new signature naturally before the
      // re-key was noticed), the conflict-update combines the two per D-3a:
      // `first_seen_at = least(existing, old.first_seen_at)`,
      // `times_seen = existing + old.times_seen`,
      // `delivered_at = coalesce(existing.delivered_at, old.delivered_at)`,
      // `dismissed_at = coalesce(existing.dismissed_at, old.dismissed_at)`.
      // The OLD row is never touched — it stays in place as the audit
      // trail (D-3a point 3).
      const [row] = await db
        .insert(findingSignatures)
        .values({
          organizationId: ctx.organizationId,
          projectId: input.projectId,
          signature: input.newSignature,
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
        })
        .onConflictDoUpdate({
          target: [
            findingSignatures.organizationId,
            findingSignatures.projectId,
            findingSignatures.signature,
          ],
          set: {
            firstSeenAt: sql`least(${findingSignatures.firstSeenAt}, excluded.first_seen_at)`,
            lastSeenAt: sql`greatest(${findingSignatures.lastSeenAt}, excluded.last_seen_at)`,
            timesSeen: sql`${findingSignatures.timesSeen} + excluded.times_seen`,
            deliveredAt: sql`coalesce(${findingSignatures.deliveredAt}, excluded.delivered_at)`,
            dismissedAt: sql`coalesce(${findingSignatures.dismissedAt}, excluded.dismissed_at)`,
          },
        })
        .returning();

      if (!row) {
        throw new Error("createFindingSignaturesRepo.carryForward: upsert returned no row");
      }

      return row;
    },
  };
}
