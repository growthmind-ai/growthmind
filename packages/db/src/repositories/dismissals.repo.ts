import type { DismissalAction, TenantContext } from "@growthmind/shared";
import { and, desc, eq } from "drizzle-orm";

import { dismissals } from "../schema/dismissals";
import { orgCrud } from "./crud";
import type { SignatureHex } from "../signatures/hex";
import type { ScopedExecutor } from "./types";

export type DismissalRecord = typeof dismissals.$inferSelect;

export interface DismissalsRepo {
  findFor(findingId: string, action: DismissalAction): Promise<DismissalRecord | null>;

  findLatestForSignature(
    projectId: string,
    signature: SignatureHex,
  ): Promise<DismissalRecord | null>;
}

export function createDismissalsRepo(db: ScopedExecutor, ctx: TenantContext): DismissalsRepo {
  const c = orgCrud(db, ctx, dismissals);

  return {
    async findFor(findingId: string, action: DismissalAction): Promise<DismissalRecord | null> {
      return c.maybe(eq(dismissals.findingId, findingId), eq(dismissals.action, action));
    },

    async findLatestForSignature(
      projectId: string,
      signature: SignatureHex,
    ): Promise<DismissalRecord | null> {
      const rows = await c.list({
        where: and(eq(dismissals.projectId, projectId), eq(dismissals.signature, signature)),
        orderBy: [desc(dismissals.dismissedAt)],
        limit: 1,
      });

      return rows[0] ?? null;
    },
  };
}
