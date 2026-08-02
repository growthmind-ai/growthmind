import { ANCESTRY_RESOLUTION_MAX_HOPS, type TenantContext } from "@growthmind/shared";
import { and, eq } from "drizzle-orm";

import { signatureAncestry } from "../schema/signature-ancestry";
import type { SignatureHex } from "../signatures/hex";
import type { ScopedDb } from "./types";

export type AncestryRecord = typeof signatureAncestry.$inferSelect;

export type AncestryResolution =
  | { readonly resolution: "resolved"; readonly signature: SignatureHex; readonly hops: number }
  | { readonly resolution: "unresolvable"; readonly cause: "cycle" | "depth_cap" };

export interface SignatureAncestryRepo {
  forwardEdge(oldSignature: SignatureHex): Promise<AncestryRecord | null>;

  resolve(signature: SignatureHex): Promise<AncestryResolution>;
}

export function createSignatureAncestryRepo(
  db: ScopedDb,
  ctx: TenantContext,
): SignatureAncestryRepo {
  return {
    async forwardEdge(oldSignature: SignatureHex): Promise<AncestryRecord | null> {
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
      const visited = new Set<SignatureHex>([signature]);
      let current = signature;

      for (let hops = 0; hops <= ANCESTRY_RESOLUTION_MAX_HOPS; hops += 1) {
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
          return { resolution: "unresolvable", cause: "depth_cap" };
        }

        visited.add(next);
        current = next;
      }

      return { resolution: "unresolvable", cause: "depth_cap" };
    },
  };
}
