import type { Membership } from "@growthmind/shared";
import { asc, eq } from "drizzle-orm";

import type { OrganizationRecord } from "../repositories/organizations.repo";
import { member, organization, user } from "../schema/auth";
import type { ScopedDb } from "../repositories/types";

export async function findMembershipsByUserId(db: ScopedDb, userId: string): Promise<Membership[]> {
  return db
    .select({
      organizationId: member.organizationId,
      organizationName: organization.name,
      role: member.role,
      createdAt: member.createdAt,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt), asc(member.organizationId));
}

export async function findOrganizationBySlug(
  db: ScopedDb,
  slug: string,
): Promise<OrganizationRecord | undefined> {
  const [row] = await db.select().from(organization).where(eq(organization.slug, slug)).limit(1);

  return row;
}

export async function findUserNameById(db: ScopedDb, userId: string): Promise<string | null> {
  const [row] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1);

  return row?.name ?? null;
}
