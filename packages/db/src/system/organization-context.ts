import type { TenantContext } from "@growthmind/shared";
import { eq } from "drizzle-orm";

import type { ScopedExecutor } from "../repositories/types";
import { organization } from "../schema/auth";
import { systemContextFor, type SystemActor } from "./system-actor";

// Turning an organization id into a context is this module's job, which is why it is the
// one place an org id is a parameter: everything downstream takes the context instead, so
// no repository or service has to be trusted with a bare id.
export async function systemContextForOrganizationId(
  db: ScopedExecutor,
  actor: SystemActor,
  id: string,
): Promise<TenantContext | null> {
  const [row] = await db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .where(eq(organization.id, id))
    .limit(1);

  if (!row) {
    return null;
  }

  return systemContextFor(actor, { organizationId: row.id, organizationName: row.name });
}
