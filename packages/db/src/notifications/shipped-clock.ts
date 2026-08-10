import { and, eq } from "drizzle-orm";

import type { ScopedExecutor } from "../repositories/types";
import { shippedChanges } from "../schema/shipped-changes";

// Both shipped emitters key on the clock the message is about, and both are handed nothing but
// the change id (ADD Decision 1), so the date is resolved here rather than threaded through a
// caller that could pass a stale one.
export async function readShippedChangeClock(
  db: ScopedExecutor,
  organizationId: string,
  changeId: string,
): Promise<Date | null> {
  const rows = await db
    .select({ readoutDueAt: shippedChanges.readoutDueAt })
    .from(shippedChanges)
    .where(and(eq(shippedChanges.organizationId, organizationId), eq(shippedChanges.id, changeId)));

  return rows[0]?.readoutDueAt ?? null;
}
