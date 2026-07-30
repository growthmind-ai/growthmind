import { schema } from "@growthmind/db";
import { deriveTenantContext, type Membership, type TenantContext } from "@growthmind/shared";
import { headers } from "next/headers";

import { getAuth } from "./auth";
import { getDb } from "./db";
import { ensureOrganization } from "./ensure-organization";

/**
 * Server-side tenant-context derivation (ADD D-C/D-G, architecture §9): the
 * only scoping input any repository or page ever sees. Composes
 * `getAuth().api.getSession(headers)` with a membership query (via
 * `@growthmind/db`) into `deriveTenantContext` (`@growthmind/shared`, pure).
 *
 * Zero memberships is the self-heal trigger state: calls `ensureOrganization`
 * and re-derives, so no signed-in user is ever observed with no organization
 * (D8) — the UI has no "no workspace" state by contract. No session at all
 * resolves to `null`, which every page-level check (D-G: no middleware)
 * redirects to `ROUTES.signIn`.
 *
 * apps/web deliberately has no `drizzle-orm` dependency of its own
 * (repositories/queries live in `packages/db` per ADD D-A) — the lookups
 * below select the whole table and filter/join in-memory, mirroring the
 * precedent already set by
 * `apps/web/__tests__/tenancy/helpers/auth-fixture.ts`.
 */

type MemberRow = typeof schema.member.$inferSelect;
type OrganizationRow = typeof schema.organization.$inferSelect;

async function readMembershipsForUser(userId: string): Promise<MemberRow[]> {
  const rows = await getDb().select().from(schema.member);
  return rows.filter((row) => row.userId === userId);
}

async function readOrganizationsByIds(organizationIds: string[]): Promise<OrganizationRow[]> {
  if (organizationIds.length === 0) {
    return [];
  }
  const idSet = new Set(organizationIds);
  const rows = await getDb().select().from(schema.organization);
  return rows.filter((row) => idSet.has(row.id));
}

/**
 * `next/headers`'s `headers()` throws when called outside an active Next.js
 * request scope (e.g. a bare test process with no dev/prod server running —
 * verified empirically, `apps/web/__tests__/tenancy/redirects.test.ts` calls
 * `getTenantContext()` with none). No request scope means no cookies, which
 * means no session either way — so that throw is treated as the same
 * signed-out state a real request with no session cookie produces, never a
 * crash.
 */
async function readRequestHeaders(): Promise<Headers | null> {
  try {
    return await headers();
  } catch {
    return null;
  }
}

export async function getTenantContext(): Promise<TenantContext | null> {
  const requestHeaders = await readRequestHeaders();
  if (!requestHeaders) {
    return null;
  }

  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) {
    return null;
  }

  const userId = session.user.id;
  let memberRows = await readMembershipsForUser(userId);

  if (memberRows.length === 0) {
    // D8 self-heal: a signed-in user must never observe an orgless state —
    // the UI has no "no workspace" view by contract. This is exactly the
    // state a missed or failed signup hook produces.
    console.error("getTenantContext: signed-in user has zero memberships — self-healing", { userId });
    await ensureOrganization(getDb(), { id: userId, name: session.user.name });
    memberRows = await readMembershipsForUser(userId);
  }

  const organizations = await readOrganizationsByIds(memberRows.map((row) => row.organizationId));
  const organizationById = new Map(organizations.map((org) => [org.id, org]));

  const memberships: Membership[] = memberRows.map((row) => ({
    organizationId: row.organizationId,
    organizationName: organizationById.get(row.organizationId)?.name ?? "",
    role: row.role,
    createdAt: row.createdAt,
  }));

  return deriveTenantContext({
    session: {
      userId,
      activeOrganizationId: session.session.activeOrganizationId ?? null,
    },
    memberships,
  });
}
