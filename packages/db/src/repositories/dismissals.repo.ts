import type { DismissalAction, TenantContext } from "@growthmind/shared";
import { and, desc, eq } from "drizzle-orm";

import { dismissals } from "../schema/dismissals";
import type { SignatureHex } from "../signatures/hex";
import type { ScopedDb } from "./types";

export type DismissalRecord = typeof dismissals.$inferSelect;

export interface DismissalsRepo {
  findFor(findingId: string, action: DismissalAction): Promise<DismissalRecord | null>;

  findLatestForSignature(
    projectId: string,
    signature: SignatureHex,
  ): Promise<DismissalRecord | null>;
}

export function createDismissalsRepo(db: ScopedDb, ctx: TenantContext): DismissalsRepo {
  return {
    async findFor(findingId: string, action: DismissalAction): Promise<DismissalRecord | null> {
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
