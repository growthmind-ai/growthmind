import { ensureOrganization, findMembershipsByUserId } from "@growthmind/db";
import { deriveTenantContext, type TenantContext } from "@growthmind/shared";
import { headers } from "next/headers";

import { getAuth } from "./auth";
import { getDb } from "./db";

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
    console.error("getTenantContext: signed-in user has zero memberships — self-healing", {
      userId,
    });
    try {
      await ensureOrganization(getDb(), { id: userId, name: session.user.name });
      memberships = await findMembershipsByUserId(getDb(), userId);
    } catch (error) {
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
