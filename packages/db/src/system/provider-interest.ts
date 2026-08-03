import type { InterestProviderId } from "@growthmind/shared";
import { count, eq, inArray, isNull } from "drizzle-orm";

import type { ScopedDb } from "../repositories/types";
import { organization } from "../schema/auth";
import { providerInterest } from "../schema/provider-interest";

export interface ClaimedProviderInterest {
  readonly id: string;
  readonly organizationId: string;

  readonly organizationName: string;
  readonly provider: InterestProviderId;
  readonly notifiedAt: Date;
}

// The stamp IS the claim, set atomically before the send (AD-2): a concurrent
// sweep finds nothing unclaimed, so no row can ever be posted twice.
export async function claimUnnotifiedProviderInterest(
  db: ScopedDb,
  now: Date,
): Promise<ClaimedProviderInterest[]> {
  const claimed = await db
    .update(providerInterest)
    .set({ notifiedAt: now })
    .where(isNull(providerInterest.notifiedAt))
    .returning();

  if (claimed.length === 0) {
    return [];
  }

  const orgIds = [...new Set(claimed.map((row) => row.organizationId))];
  const orgRows = await db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .where(inArray(organization.id, orgIds));
  const orgNames = new Map(orgRows.map((row) => [row.id, row.name]));

  return claimed.map((row) => {
    const organizationName = orgNames.get(row.organizationId);
    if (organizationName === undefined) {
      throw new Error(
        `claimUnnotifiedProviderInterest: no organization row for claimed interest ${row.id}`,
      );
    }

    return {
      id: row.id,
      organizationId: row.organizationId,
      organizationName,
      provider: row.provider,
      notifiedAt: row.notifiedAt ?? now,
    };
  });
}

// Cross-org by design: the running total is an internal aggregate carrying no PII (AD-3).
export async function countProviderInterest(
  db: ScopedDb,
  provider: InterestProviderId,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(providerInterest)
    .where(eq(providerInterest.provider, provider));

  return row?.total ?? 0;
}
