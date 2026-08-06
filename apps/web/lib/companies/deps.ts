import type { ScopedDb } from "@growthmind/db";
import type { TenantContext } from "@growthmind/shared";

import { getDb } from "@/lib/db";
import { getTenantContext } from "@/lib/tenant";

export interface CompaniesRouteDeps {
  readonly db: ScopedDb;
  readonly tenant: () => Promise<TenantContext | null>;
}

export function resolveCompaniesDeps(db: ScopedDb = getDb()): CompaniesRouteDeps {
  return { db, tenant: getTenantContext };
}
