"use server";

import { createOrganizationsRepo } from "@growthmind/db";
import { workspaceNameSchema } from "@growthmind/shared";

import { getDb } from "@/lib/db";
import { getTenantContext } from "@/lib/tenant";

const EMPTY_NAME_MESSAGE = "Give your workspace a name — anything works.";
const SAVE_FAILURE_MESSAGE = "Couldn't save that — try again.";

export type RenameWorkspaceResult = { ok: true; name: string } | { ok: false; error: string };

export async function renameWorkspace(name: string): Promise<RenameWorkspaceResult> {
  const parsed = workspaceNameSchema.safeParse(name);
  if (!parsed.success) {
    return { ok: false, error: EMPTY_NAME_MESSAGE };
  }

  const tenantContext = await getTenantContext();
  if (!tenantContext) {
    return { ok: false, error: SAVE_FAILURE_MESSAGE };
  }

  if (tenantContext.role !== "owner" && tenantContext.role !== "admin") {
    console.error("renameWorkspace: non-admin member attempted rename", {
      organizationId: tenantContext.organizationId,
      role: tenantContext.role,
    });
    return { ok: false, error: SAVE_FAILURE_MESSAGE };
  }

  try {
    const organization = await createOrganizationsRepo(getDb(), tenantContext).rename(parsed.data);
    return { ok: true, name: organization.name };
  } catch (error) {
    console.error("renameWorkspace: rename failed", {
      error,
      organizationId: tenantContext.organizationId,
    });
    return { ok: false, error: SAVE_FAILURE_MESSAGE };
  }
}
