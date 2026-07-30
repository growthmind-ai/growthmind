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
  /**
   * The email of this organization's owner — the earliest-created `member`
   * row with role `owner`, joined to `user.email`. Org-scoped by
   * construction: `ctx.organizationId` is the only org this context can name.
   *
   * The single input to internal-domain inference (O-003 FR-11).
   *
   * TYPED STUB (O-003 scaffold). FAIL DIRECTION (F-2): no owner found, or an
   * owner with no email, returns `null` ⇒ infer NOTHING. A missing creator
   * email must never produce a guess, because a wrong internal domain
   * silently excludes the customer's entire user base.
   */
  creatorEmail(): Promise<string | null>;
}

export function createOrganizationsRepo(db: ScopedDb, ctx: TenantContext): OrganizationsRepo {
  return {
    async get(): Promise<OrganizationRecord> {
      const [row] = await db
        .select()
        .from(organization)
        .where(eq(organization.id, ctx.organizationId));

      if (!row) {
        throw new Error(
          "createOrganizationsRepo.get: no organization row for constructing context",
        );
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
        throw new Error(
          "createOrganizationsRepo.rename: no organization row for constructing context",
        );
      }

      return row;
    },

    // TYPED STUB (O-003 scaffold): signature and return type are final; the
    // body throws. A later wave fills in the member-to-user join.
    creatorEmail(): Promise<string | null> {
      throw new Error("TYPED STUB (O-003 scaffold): createOrganizationsRepo.creatorEmail");
    },
  };
}
