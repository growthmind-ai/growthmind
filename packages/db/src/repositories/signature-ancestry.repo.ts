import {
  ANCESTRY_RESOLUTION_MAX_HOPS,
  type AncestryReason,
  type TenantContext,
} from "@growthmind/shared";
import { eq } from "drizzle-orm";

import { signatureAncestry } from "../schema/signature-ancestry";
import { orgCrud } from "./crud";
import type { SignatureHex } from "../signatures/hex";
import type { ScopedExecutor } from "./types";

export type AncestryRecord = typeof signatureAncestry.$inferSelect;

export type AncestryResolution =
  | { readonly resolution: "resolved"; readonly signature: SignatureHex; readonly hops: number }
  | { readonly resolution: "unresolvable"; readonly cause: "cycle" | "depth_cap" };

export interface RecordAncestryEdgeInput {
  readonly projectId: string;
  readonly oldSignature: SignatureHex;
  readonly newSignature: SignatureHex;
  readonly reason: AncestryReason;
}

export interface ClaimedAncestryEdge {
  readonly claimed: boolean;
  readonly edge: AncestryRecord;
}

export interface SignatureAncestryRepo {
  claimEdge(input: RecordAncestryEdgeInput): Promise<ClaimedAncestryEdge>;

  forwardEdge(oldSignature: SignatureHex): Promise<AncestryRecord | null>;

  resolve(signature: SignatureHex): Promise<AncestryResolution>;
}

export function createSignatureAncestryRepo(
  db: ScopedExecutor,
  ctx: TenantContext,
): SignatureAncestryRepo {
  const c = orgCrud(db, ctx, signatureAncestry);

  function edgeFrom(oldSignature: SignatureHex) {
    return c.maybe(eq(signatureAncestry.oldSignature, oldSignature));
  }

  return {
    async claimEdge(input: RecordAncestryEdgeInput): Promise<ClaimedAncestryEdge> {
      const result = await c.claim(
        {
          projectId: input.projectId,
          oldSignature: input.oldSignature,
          newSignature: input.newSignature,
          reason: input.reason,
        },
        {
          target: [signatureAncestry.organizationId, signatureAncestry.oldSignature],
          fetch: [eq(signatureAncestry.oldSignature, input.oldSignature)],
        },
      );

      if (!result.row) {
        throw new Error(
          "signature_ancestry: edge claim conflicted but no existing edge was found on read-back",
        );
      }

      return { claimed: result.claimed, edge: result.row };
    },

    async forwardEdge(oldSignature: SignatureHex): Promise<AncestryRecord | null> {
      return edgeFrom(oldSignature);
    },

    async resolve(signature: SignatureHex): Promise<AncestryResolution> {
      const visited = new Set<SignatureHex>([signature]);
      let current = signature;

      for (let hops = 0; hops <= ANCESTRY_RESOLUTION_MAX_HOPS; hops += 1) {
        // eslint-disable-next-line no-await-in-loop
        const row = await edgeFrom(current);

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
