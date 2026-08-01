// Repository for the `signature_ancestry` table (Wave 4): org-scoped at
// construction, no organization id parameter.
//
// The edge insert is deliberately absent from this repo, `recordAncestry`
// (`packages/db/src/services/signature-ledger.service.ts`) writes it inline on a `tx`
// handle in the same transaction as `carryForward`, for the same reason
// `dismissals.repo.ts` has no write method.
import { ANCESTRY_RESOLUTION_MAX_HOPS, type TenantContext } from "@growthmind/shared";
import { and, eq } from "drizzle-orm";

import { signatureAncestry } from "../schema/signature-ancestry";
import type { SignatureHex } from "../signatures/hex";
import type { ScopedDb } from "./types";

export type AncestryRecord = typeof signatureAncestry.$inferSelect;

/**
 * The outcome of walking `signature_ancestry`'s forward edges from an input signature
 * (add). `ANCESTRY_RESOLUTION_MAX_HOPS` (`packages/shared/src/signatures/types.ts`)
 * bounds the walk; the unique index on `(organization_id, old_signature)` is what makes
 * it single-valued and therefore terminating. Both `unresolvable` causes map to the
 * suppression policy's `unresolvable_ancestry` doubt branch, never a thrown error to
 * the caller.
 */
export type AncestryResolution =
  | { readonly resolution: "resolved"; readonly signature: SignatureHex; readonly hops: number }
  | { readonly resolution: "unresolvable"; readonly cause: "cycle" | "depth_cap" };

export interface SignatureAncestryRepo {
  /** The single forward edge for `oldSignature`, or `null` if none exists. The base
   * case both `resolve`'s walk and `carryForward`'s upsert build on. Org-filtered;
   * `null` for a foreign org's edge. */
  forwardEdge(oldSignature: SignatureHex): Promise<AncestryRecord | null>;
  /**
   * Walks at most `ANCESTRY_RESOLUTION_MAX_HOPS` forward edges from `signature`,
   * tracking a `visited` set. Zero edges resolves to the input signature at zero hops.
   * Degrading cleanly against an empty table is the requirement, not an error (T-DB-9,
   * never cut). A `new_signature` already in `visited` resolves `{ cause: "cycle" }`;
   * an edge still present after the hop cap resolves `{ cause: "depth_cap" }`.
   */
  resolve(signature: SignatureHex): Promise<AncestryResolution>;
}

export function createSignatureAncestryRepo(
  db: ScopedDb,
  ctx: TenantContext,
): SignatureAncestryRepo {
  return {
    async forwardEdge(oldSignature: SignatureHex): Promise<AncestryRecord | null> {
      // Scoped by (organization_id, old_signature) only. The declared exemption:
      // project_id is stamped for auditability but never filtered here, because
      // project_id is already inside the hash, so one old_signature cannot legitimately
      // span two projects.
      const [row] = await db
        .select()
        .from(signatureAncestry)
        .where(
          and(
            eq(signatureAncestry.organizationId, ctx.organizationId),
            eq(signatureAncestry.oldSignature, oldSignature),
          ),
        );

      return row ?? null;
    },

    async resolve(signature: SignatureHex): Promise<AncestryResolution> {
      // Forward walk (add): up to ANCESTRY_RESOLUTION_MAX_HOPS iterations, each
      // reading the single forward edge for the current signature. The unique index on
      // (organization_id, old_signature) makes each step single-valued and the walk
      // terminating; `visited` is belt-and-braces so a cycle is detected rather than
      // merely capped. Zero edges (the empty-table / no-edge case) resolves to the
      // input signature at zero hops, never an error.
      const visited = new Set<SignatureHex>([signature]);
      let current = signature;

      for (let hops = 0; hops <= ANCESTRY_RESOLUTION_MAX_HOPS; hops += 1) {
        // Each hop's query depends on the previous hop's result (the walk follows the
        // edge it just read); the reads cannot be parallelised with Promise.all.
        // eslint-disable-next-line no-await-in-loop
        const [row] = await db
          .select()
          .from(signatureAncestry)
          .where(
            and(
              eq(signatureAncestry.organizationId, ctx.organizationId),
              eq(signatureAncestry.oldSignature, current),
            ),
          );

        if (!row) {
          return { resolution: "resolved", signature: current, hops };
        }

        const next = row.newSignature as SignatureHex;

        if (visited.has(next)) {
          return { resolution: "unresolvable", cause: "cycle" };
        }

        if (hops === ANCESTRY_RESOLUTION_MAX_HOPS) {
          // An edge still exists after the cap, one hop past the last permitted
          // iteration.
          return { resolution: "unresolvable", cause: "depth_cap" };
        }

        visited.add(next);
        current = next;
      }

      // Unreachable, the loop above always returns by the final iteration (hops ===
      // ANCESTRY_RESOLUTION_MAX_HOPS forces a return).
      return { resolution: "unresolvable", cause: "depth_cap" };
    },
  };
}
