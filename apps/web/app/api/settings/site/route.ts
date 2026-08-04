// Names the site the ICP is read from, and asks for it to be read. Two effects, one press:
// the domain is the thing worth keeping, so it is saved before anything is queued and a
// queue that cannot be reached costs the read, never the answer.
import { createGrowthContextRepo, ensureProject, enqueueJob } from "@growthmind/db";
import { ICP_RESEARCH_TASK, settingsSiteInputSchema } from "@growthmind/shared";

import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";
import { readRequestBody, refuseBody, requireTenant } from "@/lib/first-run/gate";
import { SITE_DOMAIN_UNREADABLE, refusalResponse } from "@/lib/first-run/refusals";

export const dynamic = "force-dynamic";

export const inputSchema = settingsSiteInputSchema;

// Mirrors the adapter's own reading of a domain. A string the reader will refuse is
// refused here, where a person is looking at it, rather than as a failure minutes later.
const DOMAIN = /^[a-z0-9.-]+\.[a-z]{2,}$/i;

function domainOf(raw: string): string | null {
  const trimmed = raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();

  return trimmed.length > 0 && DOMAIN.test(trimmed) ? trimmed : null;
}

export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  const domain = domainOf(parsed.data.domain);
  if (domain === null) {
    return refusalResponse(SITE_DOMAIN_UNREADABLE);
  }

  const { projectId } = await ensureProject(deps.db, gate.ctx);

  await createGrowthContextRepo(deps.db, gate.ctx).stateSiteDomain({
    projectId,
    siteDomain: domain,
  });

  const queued = await enqueueJob(deps.db, {
    task: ICP_RESEARCH_TASK,
    payload: { projectId },
    jobKey: `${ICP_RESEARCH_TASK}:${projectId}`,
  });

  return Response.json({ saved: true, domain, queued });
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
