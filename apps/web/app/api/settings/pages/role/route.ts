// States what one page is for, on a person's authority. The nightly derivation reads what
// this writes and never writes over it, so this is the only path that produces a role
// nothing can re-derive away.
import { createGrowthContextRepo, ensureProject } from "@growthmind/db";
import { PAGES_SAVED, settingsPageRoleInputSchema } from "@growthmind/shared";

import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";
import { readRequestBody, refuseBody, requireTenant } from "@/lib/first-run/gate";
import { refusalResponse, type FirstRunGateRefusal } from "@/lib/first-run/refusals";

export const dynamic = "force-dynamic";

export const inputSchema = settingsPageRoleInputSchema;

export const PAGE_NOT_KNOWN: FirstRunGateRefusal = Object.freeze({
  code: "page_not_known",
  status: 404,
  message:
    "We do not have that page on record, so there is nothing to say about it yet. It appears here once people have used it.",
});

export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  const { projectId } = await ensureProject(deps.db, gate.ctx);
  const growth = createGrowthContextRepo(deps.db, gate.ctx);

  // Only pages this project has actually been seen to have. Without this any string would
  // mint a roled surface, and a typo would sit in the ranking answering for a page that
  // does not exist.
  const known = await growth.findForProject(projectId);
  if (known === null || !known.bySurface.has(parsed.data.surface)) {
    return refusalResponse(PAGE_NOT_KNOWN);
  }

  await growth.statePageRole({
    projectId,
    surface: parsed.data.surface,
    role: parsed.data.role,
    statedAt: deps.now(),
    ...(parsed.data.changeable === undefined ? {} : { changeable: parsed.data.changeable }),
  });

  return Response.json({ saved: true, sentence: PAGES_SAVED });
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
