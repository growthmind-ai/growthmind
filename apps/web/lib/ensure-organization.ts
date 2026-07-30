import { randomUUID } from "node:crypto";

import { schema, type ScopedDb } from "@growthmind/db";
import { deriveWorkspaceName } from "@growthmind/shared";

/**
 * Idempotent, transactional signup->org completion (ADD D-C):
 *   1. If `user` already has a membership, return it.
 *   2. Otherwise insert `organization` + `member` (role "owner") in one
 *      transaction, name from `deriveWorkspaceName(user.name)`, slug
 *      deterministically `ws-<userId>`.
 *   3. A concurrent duplicate hits the unique constraint on
 *      `organization.slug` — caught, then re-read the winner's membership
 *      (D6, settled by the constraint, not an earlier check).
 *
 * Invoked from two places: Better Auth's `user.create.after` hook (happy
 * path) and `getTenantContext()`'s self-heal path (D8: no orgless state is
 * ever observable). Failures are logged with context, never swallowed (D8).
 *
 * `db` is typed `ScopedDb` (`@growthmind/db`, `packages/db/src/repositories/types.ts`)
 * — the union of the production `NodePgDatabase` and the PGlite-backed
 * `TestDb` used by `apps/web/__tests__/tenancy/signup-org.test.ts` — so this
 * function compiles against both the real driver and the test harness
 * without a cast or `any`.
 *
 * apps/web deliberately has no `drizzle-orm` dependency of its own
 * (repositories/queries live in `packages/db` per ADD D-A) — membership
 * lookups below select the whole table and filter in-memory, mirroring the
 * precedent already set by
 * `apps/web/__tests__/tenancy/helpers/auth-fixture.ts` rather than importing
 * `eq`/`and` from `drizzle-orm` just for this file.
 */

type MemberRow = typeof schema.member.$inferSelect;

interface EnsureOrganizationResult {
  organizationId: string;
}

/** True when `error` is a Postgres unique-violation (`23505`) surfaced
 * through drizzle's `DrizzleQueryError.cause` — verified empirically against
 * both the production node-postgres driver and the PGlite test driver,
 * which wrap the underlying pg error identically. */
function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } } | null | undefined)?.cause;
  return cause?.code === "23505";
}

async function findMembershipForUser(db: ScopedDb, userId: string): Promise<MemberRow | undefined> {
  const rows = await db.select().from(schema.member);
  return rows.find((row) => row.userId === userId);
}

export async function ensureOrganization(
  db: ScopedDb,
  user: { id: string; name?: string | null },
): Promise<EnsureOrganizationResult> {
  const existing = await findMembershipForUser(db, user.id);
  if (existing) {
    return { organizationId: existing.organizationId };
  }

  // D8: this call site cannot distinguish "the routine happy-path hook call
  // immediately after signup" from "a genuine self-heal repair for a user
  // whose signup hook never ran" — both present identically (zero
  // memberships). Logging unconditionally here means the self-heal branch
  // always leaves an operator-visible trace, never a silent recovery.
  console.error("ensureOrganization: no membership found for user — creating organization", {
    userId: user.id,
  });

  const organizationId = `org-${randomUUID()}`;
  const slug = `ws-${user.id}`;
  const name = deriveWorkspaceName(user.name);
  const createdAt = new Date();

  try {
    await db.transaction(async (tx) => {
      await tx.insert(schema.organization).values({ id: organizationId, name, slug, createdAt });
      await tx.insert(schema.member).values({
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
      console.error("ensureOrganization: failed to create organization", { userId: user.id, error });
      throw error;
    }

    // D6: lost the race to a concurrent `ensureOrganization` call for this
    // same user — the winner's transaction already committed the org +
    // owner membership under this deterministic slug. The loser never
    // throws; it re-reads and returns the winner's organization.
    console.error(
      "ensureOrganization: concurrent duplicate creation detected for user — re-reading winner's organization",
      { userId: user.id, slug },
    );

    const winner = await findMembershipForUser(db, user.id);
    if (!winner) {
      const notFoundError = new Error(
        `ensureOrganization: unique-slug conflict for user "${user.id}" but no membership found on re-read`,
      );
      console.error("ensureOrganization: race re-read failed to find winner's membership", {
        userId: user.id,
        slug,
        error: notFoundError,
      });
      throw notFoundError;
    }

    return { organizationId: winner.organizationId };
  }
}
