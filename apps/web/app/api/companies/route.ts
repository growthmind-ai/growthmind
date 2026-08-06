import { COMPANY_LIST_UNREADABLE, groupSessionsByDomain, logger } from "@growthmind/shared";
import { createSessionsRepo, findFirstProjectForOrg } from "@growthmind/db";

import { toCompanyGroupDto } from "@/lib/companies/dto";
import { resolveCompaniesDeps, type CompaniesRouteDeps } from "@/lib/companies/deps";
import { companiesListRefusal } from "@/lib/companies/refusals";

export const dynamic = "force-dynamic";

// The route's own local constant (ADD D-2/§5) — not imported from packages/core, because
// this is a read-page bound (how many rows one screen can group), not a pipeline magnitude.
const GROUPABLE_SESSION_READ_CAP = 500;

export async function handle(_request: Request, deps: CompaniesRouteDeps): Promise<Response> {
  const ctx = await deps.tenant();
  if (ctx === null) {
    return companiesListRefusal("signed_out");
  }

  const project = await findFirstProjectForOrg(deps.db, ctx);
  if (project === undefined) {
    // Reading must not provision anything — same rule replay/deps.ts states outright.
    return Response.json({ groups: [], truncated: false });
  }

  let bounded;
  try {
    bounded = await createSessionsRepo(deps.db, ctx).listGroupableSessions(project.id, {
      limit: GROUPABLE_SESSION_READ_CAP,
    });
  } catch (error) {
    logger.error("companies: the groupable session list could not be read", { error });
    return Response.json({ message: COMPANY_LIST_UNREADABLE }, { status: 503 });
  }

  const groups = groupSessionsByDomain(
    bounded.sessions.flatMap((session) =>
      session.identityEmailDomain === null
        ? []
        : [{ identityEmailDomain: session.identityEmailDomain, startedAt: session.startedAt }],
    ),
  );

  return Response.json({ groups: groups.map(toCompanyGroupDto), truncated: bounded.truncated });
}

export async function GET(request: Request): Promise<Response> {
  return handle(request, resolveCompaniesDeps());
}
