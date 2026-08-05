import { asc, eq } from "drizzle-orm";

import { parseMemberRoles, type TenantContext } from "@growthmind/shared";

import { member, organization, user } from "../schema/auth";
import { scoped } from "./scope";
import type { ScopedExecutor } from "./types";

export type OrganizationRecord = typeof organization.$inferSelect;

export interface OrganizationsRepo {
  get(): Promise<OrganizationRecord>;

  rename(name: string): Promise<OrganizationRecord>;

  creatorEmail(): Promise<string | null>;
}

export function createOrganizationsRepo(db: ScopedExecutor, ctx: TenantContext): OrganizationsRepo {
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
      // The role filter is applied here rather than in SQL because the column holds several
      // roles comma-joined, which `eq(member.role, "owner")` does not match.
      const rows = await db
        .select({ email: user.email, role: member.role })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(s.org(member))
        .orderBy(asc(member.createdAt));

      const owner = rows.find((row) => parseMemberRoles(row.role).includes("owner"));

      const email = owner?.email ?? null;
      return email !== null && email.length > 0 ? email : null;
    },
  };
}
