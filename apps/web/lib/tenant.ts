import { ensureOrganization, findMembershipsByUserId } from "@growthmind/db";
import { deriveTenantContext, logger, type TenantContext } from "@growthmind/shared";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "./auth";
import { getDb } from "./db";
import { ROUTES } from "./routes";

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
    logger.error("getTenantContext: signed-in user has zero memberships — self-healing", {
      userId,
    });
    try {
      await ensureOrganization(getDb(), { id: userId, name: session.user.name });
      memberships = await findMembershipsByUserId(getDb(), userId);
    } catch (error) {
      logger.error("getTenantContext: self-heal failed — degrading to signed-out", {
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

// The one call every `(app)/` page needs: the layout already redirects a signed-out
// visitor before any page renders, but each page still needs the tenant's own data
// (organizationId, role, …), so it calls this rather than repeating the guard.
export async function requireTenantContext(): Promise<TenantContext> {
  const tenant = await getTenantContext();
  if (tenant === null) {
    redirect(ROUTES.signIn);
  }
  return tenant;
}

// The sibling for `(auth)/` pages: a visitor already signed in has nothing to do on
// sign-in/sign-up, so they're sent on rather than shown the form again.
export async function redirectIfSignedIn(destination: string = ROUTES.home): Promise<void> {
  const tenant = await getTenantContext();
  if (tenant !== null) {
    redirect(destination);
  }
}
