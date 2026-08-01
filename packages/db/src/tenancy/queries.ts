// Tenancy bootstrap reads, the queries that resolve who a request is acting as, before
// any organization scope exists.
//
// These are deliberately not repository factories. Every repository in./repositories
// takes a `TenantContext` at construction, which is the only way to name an
// organization. These functions cannot follow that shape, because they are what
// produces a `TenantContext`. Scoping them by one is circular.
// `resolveWriteKeyForIngest` (write-keys.repo.ts) is the same class of designed
// exception: credential-scoped rather than session-scoped.
//
// What keeps the exception safe. Three invariants this file must hold:
//
// 1. Every function keys on `userId` (or the user's own deterministic slug).
//  No function accepts an organization id, so none can be widened into a
//  cross-tenant read by its caller.
// 2. Each returns only rows belonging to that user.
// 3. Their output is the input to `deriveTenantContext` (@growthmind/shared),
//  which is what establishes scope. They sit below the tenant boundary,
//  not around it.
//
// Adding an organization-id parameter to anything here breaks all three. If a query
// needs one, it belongs in./repositories as a scoped factory instead.
import type { Membership } from "@growthmind/shared";
import { asc, eq } from "drizzle-orm";

import type { OrganizationRecord } from "../repositories/organizations.repo";
import { member, organization, user } from "../schema/auth";
import type { ScopedDb } from "../repositories/types";

/**
 * Every organization the user belongs to, joined to its organization row and shaped as
 * the `Membership` list `deriveTenantContext` consumes.
 *
 * The join is what makes this one round trip instead of two: the caller needs
 * `organizationName` alongside the membership, and doing it in Postgres beats
 * re-reading the organization table and joining by hand. It can never drop a
 * membership, `member.organizationId` is a not NULL foreign key to `organization.id`.
 *
 * `createdAt` is the membership's, not the organization's: it is the tiebreak
 * `resolveActiveOrganization` orders by ("oldest membership wins"), and a user can join
 * an organization long after it was created.
 *
 * Ordering is `(createdAt, organizationId)`, deliberately the same order
 * `resolveActiveOrganization` sorts by, so "the first row" and "the resolved
 * organization" can never disagree. Without it, a multi-org user's row order is
 * whatever Postgres happens to return, which makes `ensureOrganization`'s early return
 * (it takes `[0]`) nondeterministic across vacuum/update churn.
 *
 * Empty result is a legitimate state, not an error. A user with zero memberships is the
 * self-heal trigger both `getTenantContext` and the session hook handle by calling
 * `ensureOrganization`.
 */
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

/**
 * The organization holding a given slug, or `undefined`.
 *
 * Called only with a slug derived from the user's own id (`ws-<userId>`). The
 * orphan-repair branch of `ensureOrganization`, which needs to tell "lost a creation
 * race" from "the org exists but my membership row is gone".
 *
 * Deliberately not re-exported from the package barrel (`src/index.ts`), unlike its two
 * siblings here. It is the one function in this file that takes a lookup key not
 * derived from the caller's own user id, so it would resolve any organization for a
 * caller who could choose the slug. `ensureOrganization` is its only legitimate
 * consumer, and it lives in this same directory. Keeping it module-internal means there
 * is no import path by which a future route could reach it.
 */
export async function findOrganizationBySlug(
  db: ScopedDb,
  slug: string,
): Promise<OrganizationRecord | undefined> {
  const [row] = await db.select().from(organization).where(eq(organization.slug, slug)).limit(1);

  return row;
}

/**
 * One user's display name, or `null` when no such user exists.
 *
 * Selects the `name` column alone. The row also carries the user's email, which this
 * caller has no need for and which should not be read into application memory to derive
 * a workspace name.
 */
export async function findUserNameById(db: ScopedDb, userId: string): Promise<string | null> {
  const [row] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1);

  return row?.name ?? null;
}
