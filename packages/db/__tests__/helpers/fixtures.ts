// Shared repository-test seeding fixture (ADD tasks/tenancy-app-shell/add.md
// D-D, §9 cross-tenant proof). Built once so the parallel repository test
// suites (projects, write-keys, organizations, cross-tenant) don't each
// reinvent org/user/member seeding against the generated Better Auth schema.
//
// Every helper here writes real rows via `createTestDb()`'s PGlite instance
// (see ../../src/testing.ts) — no mocking, since the entire point of this
// sprint's repository tests is proving real SQL tenant scoping.
//
// Design note: this file targets `ScopedDb` (the union of the production
// node-postgres driver and the PGlite test driver — see
// ../../src/repositories/types.ts), not `TestDb` specifically, so the same
// seeders work if a future suite constructs a repo against a live-Postgres
// harness.
import { randomUUID } from "node:crypto";

import { tenantContextSchema, type TenantContext } from "@growthmind/shared";

import type { ScopedDb } from "../../src/repositories/types";
import * as schema from "../../src/schema";

export interface SeededOrganization {
  id: string;
  name: string;
  slug: string;
}

/**
 * Inserts an `organization` row (the Better Auth generated auth-schema
 * table). Generates a unique id/slug per call so two calls in one test never
 * collide against `organization.slug`'s unique index.
 */
export async function seedOrganization(
  db: ScopedDb,
  params: { name: string },
): Promise<SeededOrganization> {
  const id = randomUUID();
  const slug = `org-${id}`;

  const [row] = await db
    .insert(schema.organization)
    .values({
      id,
      name: params.name,
      slug,
      createdAt: new Date(),
    })
    .returning();

  if (!row) {
    throw new Error("seedOrganization: insert returned no row");
  }

  return { id: row.id, name: row.name, slug: row.slug };
}

export interface SeededUser {
  id: string;
}

/**
 * Inserts a `user` row. Better Auth's generated schema requires
 * `emailVerified` (defaulted here to `false`, matching an unverified
 * self-signup) even though this fixture never runs the real signup flow.
 */
export async function seedUser(
  db: ScopedDb,
  params: { name: string; email: string },
): Promise<SeededUser> {
  const id = randomUUID();

  const [row] = await db
    .insert(schema.user)
    .values({
      id,
      name: params.name,
      email: params.email,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  if (!row) {
    throw new Error("seedUser: insert returned no row");
  }

  return { id: row.id };
}

export interface SeededMember {
  id: string;
}

/**
 * Inserts a `member` row linking a user to an organization.
 * `member.createdAt` has no default in the generated schema (unlike
 * `user.createdAt`), so it must be stamped explicitly here.
 *
 * `createdAt` is overridable because it is load-bearing, not incidental:
 * `resolveActiveOrganization` picks the OLDEST membership, so a suite proving
 * ordering needs to control it rather than race the clock.
 */
export async function seedMember(
  db: ScopedDb,
  params: { organizationId: string; userId: string; role?: string; createdAt?: Date },
): Promise<SeededMember> {
  const id = randomUUID();

  const [row] = await db
    .insert(schema.member)
    .values({
      id,
      organizationId: params.organizationId,
      userId: params.userId,
      role: params.role ?? "member",
      createdAt: params.createdAt ?? new Date(),
    })
    .returning();

  if (!row) {
    throw new Error("seedMember: insert returned no row");
  }

  return { id: row.id };
}

/**
 * Builds a `TenantContext` for constructing repositories in tests.
 * Constructed via `tenantContextSchema.parse` (not a bare object literal) so
 * a caller can never hand a repository-under-test a context shape that
 * wouldn't also pass the real derivation path's own validation.
 */
export function makeTenantContext(params: {
  userId: string;
  organizationId: string;
  organizationName: string;
  role?: string;
}): TenantContext {
  return tenantContextSchema.parse({
    userId: params.userId,
    organizationId: params.organizationId,
    organizationName: params.organizationName,
    role: params.role ?? "owner",
  });
}

export interface SeededOrgWithOwner {
  organizationId: string;
  organizationName: string;
  userId: string;
  ctx: TenantContext;
}

/**
 * Convenience for the common case: an org with one owner member and a
 * ready-to-use `TenantContext` for that owner. Almost every repository test
 * needs exactly this before it can build a second org/member for the
 * cross-tenant fixture shape (architecture §9): call this twice for org A
 * and org B, then `seedUser` + `seedMember` again for a non-owner teammate
 * in org A.
 */
export async function seedOrgWithOwner(
  db: ScopedDb,
  params: { orgName: string; userName: string; email: string },
): Promise<SeededOrgWithOwner> {
  const org = await seedOrganization(db, { name: params.orgName });
  const user = await seedUser(db, { name: params.userName, email: params.email });
  await seedMember(db, { organizationId: org.id, userId: user.id, role: "owner" });

  const ctx = makeTenantContext({
    userId: user.id,
    organizationId: org.id,
    organizationName: org.name,
    role: "owner",
  });

  return { organizationId: org.id, organizationName: org.name, userId: user.id, ctx };
}
