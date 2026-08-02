import { and, asc, eq } from "drizzle-orm";

import type { TenantContext } from "@growthmind/shared";

import { member, organization, user } from "../schema/auth";
import type { ScopedDb } from "./types";

export type OrganizationRecord = typeof organization.$inferSelect;

export interface OrganizationsRepo {
  get(): Promise<OrganizationRecord>;

  rename(name: string): Promise<OrganizationRecord>;

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
