"use server";

import { createOrganizationsRepo } from "@growthmind/db";
import { workspaceNameSchema } from "@growthmind/shared";

import { getDb } from "@/lib/db";
import { getTenantContext } from "@/lib/tenant";

// P1 rename (ADD D-H): a server action, deliberately — it mints no API
// route nothing else consumes. Org scoping comes ONLY from the
// session-derived tenant context (`getTenantContext()`); this action takes
// no organization id parameter, matching `createOrganizationsRepo`'s
// structural guarantee (ADD D-B) that a foreign org can never be named.
//
// Copy is normative (UX spec §5, First-Run Checklist row 9) — shipped
// verbatim. Raw Zod messages and raw errors/stacks never reach the caller.
const EMPTY_NAME_MESSAGE = "Give your workspace a name — anything works.";
const SAVE_FAILURE_MESSAGE = "Couldn't save that — try again.";

export type RenameWorkspaceResult = { ok: true; name: string } | { ok: false; error: string };

export async function renameWorkspace(name: string): Promise<RenameWorkspaceResult> {
  const parsed = workspaceNameSchema.safeParse(name);
  if (!parsed.success) {
    return { ok: false, error: EMPTY_NAME_MESSAGE };
  }

  // Signed-out mid-edit (session expired while the form was open) must fail
  // cleanly with the same plain-English message as any other save failure —
  // never a raw stack or an unauthenticated crash.
  const tenantContext = await getTenantContext();
  if (!tenantContext) {
    return { ok: false, error: SAVE_FAILURE_MESSAGE };
  }

  try {
    const organization = await createOrganizationsRepo(getDb(), tenantContext).rename(parsed.data);
    return { ok: true, name: organization.name };
  } catch (error) {
    console.error("renameWorkspace: rename failed", { error, organizationId: tenantContext.organizationId });
    return { ok: false, error: SAVE_FAILURE_MESSAGE };
  }
}
