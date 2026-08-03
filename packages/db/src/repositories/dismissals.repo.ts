import type { DismissalAction, TenantContext } from "@growthmind/shared";
import { desc, eq } from "drizzle-orm";

import { dismissals } from "../schema/dismissals";
import { scoped } from "./scope";
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
  const s = scoped(db, ctx);

  return {
    async findFor(findingId: string, action: DismissalAction): Promise<DismissalRecord | null> {
      return s.maybe(
        await db
          .select()
          .from(dismissals)
          .where(
            s.owned(dismissals, eq(dismissals.findingId, findingId), eq(dismissals.action, action)),
          ),
      );
    },

    async findLatestForSignature(
      projectId: string,
      signature: SignatureHex,
    ): Promise<DismissalRecord | null> {
      return s.maybe(
        await db
          .select()
          .from(dismissals)
          .where(
            s.owned(
              dismissals,
              eq(dismissals.projectId, projectId),
              eq(dismissals.signature, signature),
            ),
          )
          .orderBy(desc(dismissals.dismissedAt))
          .limit(1),
      );
    },
  };
}
