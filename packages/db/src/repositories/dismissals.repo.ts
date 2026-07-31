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
import type { DismissalAction, TenantContext } from "@growthmind/shared";
import { and, desc, eq } from "drizzle-orm";

import { dismissals } from "../schema/dismissals";
import type { SignatureHex } from "../signatures/hex";
import type { ScopedDb } from "./types";

export type DismissalRecord = typeof dismissals.$inferSelect;

export interface DismissalsRepo {
  /** Org-filtered lookup keyed on the same `(organization_id, finding_id,
   * action)` unique index the write path conflicts on — `null` when no
   * dismissal has been recorded for this finding/action, or for a foreign
   * org's finding. */
  findFor(findingId: string, action: DismissalAction): Promise<DismissalRecord | null>;
  /** Org- AND project-filtered lookup by signature, newest first — the read
   * `consultSignature` uses to check for a prior dismissal without joining
   * `findings`. `null` when this signature has never been dismissed under
   * this org/project.
   *
   * `projectId` NARROWS THIS QUERY (review CR-13). An earlier draft accepted
   * it and immediately discarded it "for call-site symmetry" — a parameter
   * that looks like a scope narrowing and is not is the D2 trap this
   * codebase has already paid for. D-10's declared exemption
   * ("`dismissals.project_id` is stamped but never filtered on") is
   * satisfied by `findFor`, which takes no project at all; a read whose
   * caller HANDS us a project id must honour it, or a caller passing a
   * foreign project id would be answered from another project's history. */
  findLatestForSignature(
    projectId: string,
    signature: SignatureHex,
  ): Promise<DismissalRecord | null>;
}

export function createDismissalsRepo(db: ScopedDb, ctx: TenantContext): DismissalsRepo {
  return {
    async findFor(findingId: string, action: DismissalAction): Promise<DismissalRecord | null> {
      // Keyed on the same tuple the unique index conflicts on
      // (organization_id, finding_id, action) — D-10 row 2.
      const [row] = await db
        .select()
        .from(dismissals)
        .where(
          and(
            eq(dismissals.organizationId, ctx.organizationId),
            eq(dismissals.findingId, findingId),
            eq(dismissals.action, action),
          ),
        );

      return row ?? null;
    },

    async findLatestForSignature(
      projectId: string,
      signature: SignatureHex,
    ): Promise<DismissalRecord | null> {
      // organization_id FIRST, then the project the caller named, then the
      // signature. `project_id` is inside the signature's own hash (D-5), so
      // this predicate can never exclude a legitimate row — it can only
      // refuse a caller who named a project the dismissal does not belong to.
      const [row] = await db
        .select()
        .from(dismissals)
        .where(
          and(
            eq(dismissals.organizationId, ctx.organizationId),
            eq(dismissals.projectId, projectId),
            eq(dismissals.signature, signature),
          ),
        )
        .orderBy(desc(dismissals.dismissedAt))
        .limit(1);

      return row ?? null;
    },
  };
}
