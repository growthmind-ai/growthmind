// Repository for the `finding_signatures` table (O-006 ADD §2 D-9, D-10;
// §5 Wave 4). D-B: org-scoped at construction, no organization id parameter,
// mutations keyed on `(organization_id, project_id, signature)` — there is
// no `updateById`.
//
// STUB (Wave 0B / T3, schema + TDD-contract task): every exported type and
// the factory's signature are FINAL. Every method body throws
// "not implemented"; a later wave fills them in against the failing tests a
// later wave writes.
import type { TenantContext } from "@growthmind/shared";
import type { FindingClass } from "@growthmind/core";

import type { findingSignatures } from "../schema/finding-signatures";
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
  void db;
  void ctx;

  return {
    async upsertSeen(input: UpsertSeenInput): Promise<FindingSignatureRecord> {
      void input;
      throw new Error("not implemented");
    },

    async findBySignature(
      projectId: string,
      signature: SignatureHex,
    ): Promise<FindingSignatureRecord | null> {
      void projectId;
      void signature;
      throw new Error("not implemented");
    },

    async markDelivered(
      projectId: string,
      signature: SignatureHex,
      at: Date,
    ): Promise<FindingSignatureRecord | null> {
      void projectId;
      void signature;
      void at;
      throw new Error("not implemented");
    },

    async carryForward(input: CarryForwardInput): Promise<FindingSignatureRecord> {
      void input;
      throw new Error("not implemented");
    },
  };
}
