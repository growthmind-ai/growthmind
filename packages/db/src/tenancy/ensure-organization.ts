import { randomUUID } from "node:crypto";

import { deriveWorkspaceName } from "@growthmind/shared";

import { member, organization } from "../schema/auth";
import type { ScopedDb } from "../repositories/types";
import { findMembershipsByUserId, findOrganizationBySlug } from "./queries";

/**
 * Idempotent, transactional signup->org completion:
 * 1. If `user` already has a membership, return it.
 * 2. Otherwise insert `organization` + `member` (role "owner") in one
 *  transaction, name from `deriveWorkspaceName(user.name)`, slug
 *  deterministically `ws-<userId>`.
 * 3. A concurrent duplicate hits the unique constraint on
 *  `organization.slug` — caught, then re-read the winner's membership
 *  (settled by the constraint, not an earlier check).
 *
 * Invoked from two places in `apps/web`: Better Auth's `user.create.after` hook (happy
 * path) and `getTenantContext`'s self-heal path (no orgless state is ever
 * observable). Failures are logged with context, never swallowed.
 *
 * `db` is typed `ScopedDb` (./repositories/types). The union of the production
 * `NodePgDatabase` and the PGlite-backed `TestDb`, so this function compiles against
 * both the real driver and the test harness without a cast or `any`.
 */

interface EnsureOrganizationResult {
  organizationId: string;
}

/** True when `error` is a Postgres unique-violation surfaced through
 * drizzle's `DrizzleQueryError.cause`. Verified empirically against both the production
 * node-postgres driver and the PGlite test driver, which wrap the underlying pg error
 * identically. */
function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } } | null | undefined)?.cause;
  return cause?.code === "23505";
}

export async function ensureOrganization(
  db: ScopedDb,
  user: { id: string; name?: string | null },
): Promise<EnsureOrganizationResult> {
  const [existing] = await findMembershipsByUserId(db, user.id);
  if (existing) {
    return { organizationId: existing.organizationId };
  }

  // This call site cannot distinguish "the routine happy-path hook call immediately
  // after signup" from "a genuine self-heal repair for a user whose signup hook never
  // ran". Both present identically (zero memberships). Logging unconditionally here
  // means the self-heal branch always leaves an operator-visible trace, never a silent
  // recovery.
  console.error("ensureOrganization: no membership found for user — creating organization", {
    userId: user.id,
  });

  const organizationId = `org-${randomUUID()}`;
  const slug = `ws-${user.id}`;
  const name = deriveWorkspaceName(user.name);
  const createdAt = new Date();

  try {
    await db.transaction(async (tx) => {
      await tx.insert(organization).values({ id: organizationId, name, slug, createdAt });
      await tx.insert(member).values({
        id: `member-${randomUUID()}`,
        organizationId,
        userId: user.id,
        role: "owner",
        createdAt,
      });
    });

    return { organizationId };
  } catch (error) {
    if (!isUniqueViolation(error)) {
      console.error("ensureOrganization: failed to create organization", {
        userId: user.id,
        error,
      });
      throw error;
    }

    // Lost the race to a concurrent `ensureOrganization` call for this same user. The
    // winner's transaction already committed the org + owner membership under this
    // deterministic slug. The loser never throws; it re-reads and returns the winner's
    // organization.
    console.error(
      "ensureOrganization: concurrent duplicate creation detected for user — re-reading winner's organization",
      { userId: user.id, slug },
    );

    const [winner] = await findMembershipsByUserId(db, user.id);
    if (winner) {
      return { organizationId: winner.organizationId };
    }

    // Not the concurrency race: the org owning this user's deterministic slug exists,
    // but the user holds no membership in it. The orphaned-org state a removed
    // membership leaves behind (Better Auth's organization plugin exposes member
    // removal, and the user's own leave, at /api/auth/organization/*). Re-reading
    // membership alone can never resolve it, so throwing here bricked the account
    // permanently: the slug is derived from the user id, so every retry collides
    // identically, and because `/`, `/sign-in`, and `/sign-up` all resolve tenant
    // context, the user got a 500 on every page, including the one they would sign out
    // from. Re-insert the missing membership instead; the org is theirs by construction
    // (slug = `ws-<their user id>`).
    const orphaned = await findOrganizationBySlug(db, slug);
    if (orphaned) {
      console.error(
        "ensureOrganization: org exists for slug but membership is missing — restoring membership",
        {
          userId: user.id,
          slug,
          organizationId: orphaned.id,
        },
      );

      await db.insert(member).values({
        id: `member-${randomUUID()}`,
        organizationId: orphaned.id,
        userId: user.id,
        role: "owner",
        createdAt,
      });

      return { organizationId: orphaned.id };
    }

    const notFoundError = new Error(
      `ensureOrganization: unique-slug conflict for user "${user.id}" but neither membership nor slug-owning organization found`,
    );
    console.error(
      "ensureOrganization: conflict re-read found neither membership nor organization",
      {
        userId: user.id,
        slug,
        error: notFoundError,
      },
    );
    throw notFoundError;
  }
}
