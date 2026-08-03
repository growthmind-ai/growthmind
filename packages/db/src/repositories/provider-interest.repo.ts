import type { InterestProviderId, TenantContext } from "@growthmind/shared";
import { asc, eq } from "drizzle-orm";

import { providerInterest } from "../schema/provider-interest";
import { orgCrud } from "./crud";
import type { ScopedExecutor } from "./types";

export interface ProviderInterestNote {
  // True only on the first insert for (org, provider) — the signal FR-9 fires on.
  readonly claimed: boolean;
}

export interface ProviderInterestRepo {
  note(provider: InterestProviderId, requestedBy: string): Promise<ProviderInterestNote>;

  listNotedProviders(): Promise<readonly InterestProviderId[]>;
}

export function createProviderInterestRepo(
  db: ScopedExecutor,
  ctx: TenantContext,
): ProviderInterestRepo {
  const crud = orgCrud(db, ctx, providerInterest);

  return {
    async note(
      provider: InterestProviderId,
      requestedBy: string,
    ): Promise<ProviderInterestNote> {
      // No `set` clause: crud branches to onConflictDoNothing, so a repeat is
      // claimed=false with the existing row untouched (AD-3, D6).
      const result = await crud.claim(
        { provider, requestedBy },
        {
          target: [providerInterest.organizationId, providerInterest.provider],
          fetch: [eq(providerInterest.provider, provider)],
        },
      );

      return { claimed: result.claimed };
    },

    async listNotedProviders(): Promise<readonly InterestProviderId[]> {
      const rows = await crud.list({ orderBy: [asc(providerInterest.createdAt)] });

      return rows.map((row) => row.provider);
    },
  };
}
