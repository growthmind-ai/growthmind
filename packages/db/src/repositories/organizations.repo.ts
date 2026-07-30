// Repository for the (generated, Better Auth) `organization` table. D-B:
// the factory takes a `TenantContext` at construction; both methods key
// solely on `ctx.organizationId` — there is no id parameter to accept at
// all, so a foreign org can never be named.
//
// TYPED STUB (m0 scaffold): signatures and return types are final; bodies
// throw. A later wave fills in the Drizzle queries against these exact
// signatures.
import { eq } from "drizzle-orm";

import type { TenantContext } from "@growthmind/shared";

import { organization } from "../schema/auth";
import type { ScopedDb } from "./types";

export type OrganizationRecord = typeof organization.$inferSelect;

export interface OrganizationsRepo {
  /** The constructing context's own organization row. */
  get(): Promise<OrganizationRecord>;
  /** Renames the constructing context's own organization — never any
   * other org, since no organization id is ever accepted as a parameter. */
  rename(name: string): Promise<OrganizationRecord>;
}

export function createOrganizationsRepo(db: ScopedDb, ctx: TenantContext): OrganizationsRepo {
  return {
    async get(): Promise<OrganizationRecord> {
      const [row] = await db
        .select()
        .from(organization)
        .where(eq(organization.id, ctx.organizationId));

      if (!row) {
        throw new Error("createOrganizationsRepo.get: no organization row for constructing context");
      }

      return row;
    },

    async rename(name: string): Promise<OrganizationRecord> {
      const [row] = await db
        .update(organization)
        .set({ name })
        .where(eq(organization.id, ctx.organizationId))
        .returning();

      if (!row) {
        throw new Error("createOrganizationsRepo.rename: no organization row for constructing context");
      }

      return row;
    },
  };
}
