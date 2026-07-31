// Repository for the `dismissals` table (O-006 ADD §2 D-7, D-8; §5 Wave 4).
// D-B: org-scoped at construction, no organization id parameter.
//
// The WRITE is deliberately absent from this repo — `recordDismissal`
// (`packages/db/src/services/signature-ledger.service.ts`) performs it
// inline on a `tx` handle because it must land in the same transaction as
// the ledger's `dismissed_at` stamp (ADD D-8). `ScopedDb` is a union of two
// driver types with no `.transaction`-callback overload that narrows to a
// repository factory, so a transactional write belongs in the service, not
// here — the same reason `ensure-organization.ts` writes on `tx` directly
// rather than through a repository.
//
// STUB (Wave 0B / T3, schema + TDD-contract task): every exported type and
// the factory's signature are FINAL. Every method body throws
// "not implemented"; a later wave fills them in against the failing tests a
// later wave writes.
import type { DismissalAction, TenantContext } from "@growthmind/shared";

import type { dismissals } from "../schema/dismissals";
import type { SignatureHex } from "../signatures/hex";
import type { ScopedDb } from "./types";

export type DismissalRecord = typeof dismissals.$inferSelect;

export interface DismissalsRepo {
  /** Org-filtered lookup keyed on the same `(organization_id, finding_id,
   * action)` unique index the write path conflicts on — `null` when no
   * dismissal has been recorded for this finding/action, or for a foreign
   * org's finding. */
  findFor(findingId: string, action: DismissalAction): Promise<DismissalRecord | null>;
  /** Org-filtered lookup by signature, newest first — the read `consultSignature`
   * and `recordDismissal` use to check for a prior dismissal without joining
   * `findings`. `null` when this signature has never been dismissed. */
  findLatestForSignature(projectId: string, signature: SignatureHex): Promise<DismissalRecord | null>;
}

export function createDismissalsRepo(db: ScopedDb, ctx: TenantContext): DismissalsRepo {
  void db;
  void ctx;

  return {
    async findFor(findingId: string, action: DismissalAction): Promise<DismissalRecord | null> {
      void findingId;
      void action;
      throw new Error("not implemented");
    },

    async findLatestForSignature(
      projectId: string,
      signature: SignatureHex,
    ): Promise<DismissalRecord | null> {
      void projectId;
      void signature;
      throw new Error("not implemented");
    },
  };
}
