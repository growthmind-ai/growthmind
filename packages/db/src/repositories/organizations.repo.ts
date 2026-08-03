import { and, asc, eq } from "drizzle-orm";

import type { TenantContext } from "@growthmind/shared";

import { member, organization, user } from "../schema/auth";
import { scoped } from "./scope";
import type { ScopedDb } from "./types";

export type OrganizationRecord = typeof organization.$inferSelect;

export interface OrganizationsRepo {
  get(): Promise<OrganizationRecord>;

  rename(name: string): Promise<OrganizationRecord>;

  creatorEmail(): Promise<string | null>;
}

export function createOrganizationsRepo(db: ScopedDb, ctx: TenantContext): OrganizationsRepo {
  const s = scoped(db, ctx);

  return {
    async get(): Promise<OrganizationRecord> {
      const rows = await db.select().from(organization).where(s.orgId(organization.id));

      return s.one(rows, "createOrganizationsRepo.get");
    },

    async rename(name: string): Promise<OrganizationRecord> {
      const rows = await db
        .update(organization)
        .set({ name })
        .where(s.orgId(organization.id))
        .returning();

      return s.one(rows, "createOrganizationsRepo.rename");
    },

    async creatorEmail(): Promise<string | null> {
      const row = s.maybe(
        await db
          .select({ email: user.email })
          .from(member)
          .innerJoin(user, eq(user.id, member.userId))
          .where(and(s.org(member), eq(member.role, "owner")))
          .orderBy(asc(member.createdAt))
          .limit(1),
      );

      const email = row?.email ?? null;
      return email !== null && email.length > 0 ? email : null;
    },
  };
}
