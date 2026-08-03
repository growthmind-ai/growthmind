import type { Membership } from "@growthmind/shared";
import { asc, desc, eq } from "drizzle-orm";

import type { OrganizationRecord } from "../repositories/organizations.repo";
import { account, member, organization, user } from "../schema/auth";
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

// Newest first: a user who linked a second provider signs in through the one they just
// used, and the sign-in event should name that rather than whichever came first.
export async function findNewestAccountProviderId(
  db: ScopedDb,
  userId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ providerId: account.providerId })
    .from(account)
    .where(eq(account.userId, userId))
    .orderBy(desc(account.createdAt))
    .limit(1);

  return row?.providerId ?? null;
}
