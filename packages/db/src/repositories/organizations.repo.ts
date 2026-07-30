// Repository for the (generated, Better Auth) `organization` table. D-B:
// the factory takes a `TenantContext` at construction; both methods key
// solely on `ctx.organizationId` — there is no id parameter to accept at
// all, so a foreign org can never be named. `creatorEmail()` keys on the same
// context and joins `member` → `user`, so it too has no org parameter.
import { and, asc, eq } from "drizzle-orm";

import type { TenantContext } from "@growthmind/shared";

import { member, organization, user } from "../schema/auth";
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
   * FAIL DIRECTION (F-2): no owner found, or an
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

    async creatorEmail(): Promise<string | null> {
      // Org-scoped by construction: `ctx.organizationId` is the only org this
      // context can name, and the join is inner — a `member` row pointing at a
      // deleted user simply drops out rather than resolving to a partial row.
      //
      // FAIL DIRECTION F-2: `?? null`, never a fallback to "the earliest
      // member of any role". An org whose only member is a plain `member`
      // (Better Auth's shape when the owner has left) must infer NOTHING —
      // a wrong internal domain silently excludes the customer's entire user
      // base, which is worse than inferring none at all.
      const [row] = await db
        .select({ email: user.email })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(and(eq(member.organizationId, ctx.organizationId), eq(member.role, "owner")))
        .orderBy(asc(member.createdAt))
        .limit(1);

      const email = row?.email ?? null;
      return email !== null && email.length > 0 ? email : null;
    },
  };
}
