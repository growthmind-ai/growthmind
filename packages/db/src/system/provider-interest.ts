import type { InterestProviderId } from "@growthmind/shared";
import { and, asc, count, eq, exists, inArray, isNull } from "drizzle-orm";

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
// sweep finds nothing unclaimed, so no row can ever be posted twice. The
// enrichment shares the claim's transaction, so an infra throw rolls the
// stamps back and a retry finds the rows unclaimed instead of stamped-and-lost.
// A row whose organization is already gone is left unclaimed rather than
// stamped and dropped. The cap paces a backlog; the next tick drains the rest.
export async function claimUnnotifiedProviderInterest(
  db: ScopedDb,
  now: Date,
  limit = 25,
): Promise<ClaimedProviderInterest[]> {
  if (limit <= 0) {
    return [];
  }

  return db.transaction(async (tx) => {
    const unnotified = tx
      .select({ id: providerInterest.id })
      .from(providerInterest)
      .where(
        and(
          isNull(providerInterest.notifiedAt),
          exists(
            tx
              .select({ id: organization.id })
              .from(organization)
              .where(eq(organization.id, providerInterest.organizationId)),
          ),
        ),
      )
      .orderBy(asc(providerInterest.createdAt), asc(providerInterest.id))
      .limit(limit)
      .for("update", { skipLocked: true });

    // The repeated isNull guard is what a lock-wait re-check evaluates, so an
    // overlapping sweep that loses the race stamps nothing a winner already has.
    const claimed = await tx
      .update(providerInterest)
      .set({ notifiedAt: now })
      .where(and(isNull(providerInterest.notifiedAt), inArray(providerInterest.id, unnotified)))
      .returning();

    if (claimed.length === 0) {
      return [];
    }

    const orgIds = [...new Set(claimed.map((row) => row.organizationId))];
    const orgRows = await tx
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
