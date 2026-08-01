"use server";

import { createOrganizationsRepo } from "@growthmind/db";
import { workspaceNameSchema } from "@growthmind/shared";

import { getDb } from "@/lib/db";
import { getTenantContext } from "@/lib/tenant";

// P1 rename: a server action, deliberately. It mints no API route nothing else
// consumes. Org scoping comes only from the session-derived tenant context
// (`getTenantContext`); this action takes no organization id parameter, matching
// `createOrganizationsRepo`'s structural guarantee that a foreign org can never be
// named.
//
// Copy is normative (UX spec, First-Run Checklist row 9). Shipped verbatim. Raw Zod
// messages and raw errors/stacks never reach the caller.
const EMPTY_NAME_MESSAGE = "Give your workspace a name — anything works.";
const SAVE_FAILURE_MESSAGE = "Couldn't save that — try again.";

export type RenameWorkspaceResult = { ok: true; name: string } | { ok: false; error: string };

export async function renameWorkspace(name: string): Promise<RenameWorkspaceResult> {
  const parsed = workspaceNameSchema.safeParse(name);
  if (!parsed.success) {
    return { ok: false, error: EMPTY_NAME_MESSAGE };
  }

  // Signed-out mid-edit (session expired while the form was open) must fail cleanly
  // with the same plain-English message as any other save failure, never a raw stack or
  // an unauthenticated crash.
  const tenantContext = await getTenantContext();
  if (!tenantContext) {
    return { ok: false, error: SAVE_FAILURE_MESSAGE };
  }

  // audience decision, named explicitly: renaming the workspace is an org-wide effect,
  // so it is owner/admin-only, not any member. This matches Better Auth's own access
  // control, which reserves `organization:update` for those roles; without this check
  // the server action would grant a capability the auth layer it sits on deliberately
  // withholds. Cross-org renaming is already impossible by construction
  // (OrganizationsRepo.rename accepts no organization id). This closes the within-org
  // privilege gap.
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
