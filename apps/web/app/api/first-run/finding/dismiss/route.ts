// Never the screen's own dismiss state (apps/web/app/api/first-run/dismiss/route.ts) — this
// route dismisses one finding, keyed on a client-captured findingId (ADD o-019-dismissal-wired
// Decision 2 part A), because "the current finding" is a moving target across a double-press.
import {
  createFindingsRepo,
  createSignatureLedgerService,
  ensureProject,
  signatureHex,
} from "@growthmind/db";
import { firstRunFindingDismissInputSchema } from "@growthmind/shared";

import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";
import { readRequestBody, refuseBody, requireTenant } from "@/lib/first-run/gate";
import { FINDING_NOT_FOUND, refusalResponse } from "@/lib/first-run/refusals";

export const dynamic = "force-dynamic";

export const inputSchema = firstRunFindingDismissInputSchema;

export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  const { projectId } = await ensureProject(deps.db, gate.ctx);

  const finding = await createFindingsRepo(deps.db, gate.ctx).findById(
    projectId,
    parsed.data.findingId,
  );
  if (finding === null) {
    return refusalResponse(FINDING_NOT_FOUND);
  }

  await createSignatureLedgerService(deps.db, gate.ctx).recordDismissal({
    projectId,
    findingId: finding.id,
    signature: signatureHex(finding.signature),
    action: "not_useful",
    dismissedByUserId: gate.ctx.userId,
  });

  return Response.json({ dismissed: true });
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
