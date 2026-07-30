import { ensureOrganization, findMembershipsByUserId } from "@growthmind/db";
import { deriveTenantContext, type TenantContext } from "@growthmind/shared";
import { headers } from "next/headers";

import { getAuth } from "./auth";
import { getDb } from "./db";

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
 * This runs on every authenticated page render, so the membership lookup must
 * stay a single indexed query — see `findMembershipsByUserId` in
 * `@growthmind/db`, which joins the organization row in Postgres rather than
 * making this file read a second table and stitch the two together.
 */

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
  let memberships = await findMembershipsByUserId(getDb(), userId);

  if (memberships.length === 0) {
    // D8 self-heal: a signed-in user must never observe an orgless state —
    // the UI has no "no workspace" view by contract. This is exactly the
    // state a missed or failed signup hook produces.
    console.error("getTenantContext: signed-in user has zero memberships — self-healing", {
      userId,
    });
    try {
      await ensureOrganization(getDb(), { id: userId, name: session.user.name });
      memberships = await findMembershipsByUserId(getDb(), userId);
    } catch (error) {
      // D8 failure isolation: the self-heal is a repair, not the request. If
      // it fails, degrade to the signed-out path (caller redirects to
      // /sign-in) rather than propagating. Propagating threw a 500 from EVERY
      // page — `/`, `/sign-in`, and `/sign-up` all resolve tenant context — so
      // a user in this state could not even reach a page to sign out from.
      console.error("getTenantContext: self-heal failed — degrading to signed-out", {
        userId,
        error,
      });
      return null;
    }
  }

  return deriveTenantContext({
    session: {
      userId,
      activeOrganizationId: session.session.activeOrganizationId ?? null,
    },
    memberships,
  });
}
