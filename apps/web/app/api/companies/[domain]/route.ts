import {
  COMPANY_DETAIL_NOT_FOUND,
  COMPANY_SESSIONS_UNREADABLE,
  isFreeMailDomain,
  logger,
  recordingIdFromSessionKey,
} from "@growthmind/shared";
import {
  createRecordingSummariesRepo,
  createSessionsRepo,
  findFirstProjectForOrg,
  type FindingText,
} from "@growthmind/db";

import { resolveCompanySessionStory, toCompanySessionDto } from "@/lib/companies/dto";
import { resolveCompaniesDeps, type CompaniesRouteDeps } from "@/lib/companies/deps";
import { companiesDetailRefusal } from "@/lib/companies/refusals";

export const dynamic = "force-dynamic";

// The route's own local constant (ADD D-2/§5) — not imported from packages/core, same
// per-package-ownership reasoning as GROUPABLE_SESSION_READ_CAP in the list route.
const COMPANY_SESSION_ROW_CAP = 100;

export async function handle(
  _request: Request,
  domain: string,
  deps: CompaniesRouteDeps,
): Promise<Response> {
  const ctx = await deps.tenant();
  if (ctx === null) {
    return companiesDetailRefusal("signed_out");
  }

  // Free-mail is never an account — refused before any query, same policy as the list.
  if (domain.trim() === "" || isFreeMailDomain(domain)) {
    return Response.json({ message: COMPANY_DETAIL_NOT_FOUND }, { status: 404 });
  }

  const project = await findFirstProjectForOrg(deps.db, ctx);
  if (project === undefined) {
    return Response.json({ message: COMPANY_DETAIL_NOT_FOUND }, { status: 404 });
  }

  let bounded;
  try {
    bounded = await createSessionsRepo(deps.db, ctx).listSessionsForDomain(project.id, domain, {
      limit: COMPANY_SESSION_ROW_CAP,
    });
  } catch (error) {
    logger.error("companies: a company's sessions could not be read", { error });
    return Response.json({ message: COMPANY_SESSIONS_UNREADABLE }, { status: 503 });
  }

  // Never existed, belongs to another org, or aged out — all three are one shape (D7: a
  // cross-org guess must be indistinguishable from a typo).
  if (bounded.sessions.length === 0) {
    return Response.json({ message: COMPANY_DETAIL_NOT_FOUND }, { status: 404 });
  }

  const summariesRepo = createRecordingSummariesRepo(deps.db, ctx);
  const recordingIds = new Set(
    bounded.sessions.flatMap((session) => {
      const id = recordingIdFromSessionKey(session.sessionKey);
      return id === null ? [] : [id];
    }),
  );

  const textByRecordingId = new Map<string, FindingText | null>();
  await Promise.all(
    [...recordingIds].map(async (recordingId) => {
      try {
        const record = await summariesRepo.findFor(project.id, recordingId);
        textByRecordingId.set(recordingId, record?.text ?? null);
      } catch (error) {
        // D8: one session's story failing to read must not blank the ones that did.
        logger.error("companies: a session's story could not be read", { error, recordingId });
        textByRecordingId.set(recordingId, null);
      }
    }),
  );

  const sessionDtos = bounded.sessions.map((session) => {
    const recordingId = recordingIdFromSessionKey(session.sessionKey);
    const text = recordingId === null ? null : (textByRecordingId.get(recordingId) ?? null);
    return toCompanySessionDto(session, recordingId, resolveCompanySessionStory(recordingId, text));
  });

  return Response.json({ sessions: sessionDtos, truncated: bounded.truncated });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ domain: string }> },
): Promise<Response> {
  const { domain } = await context.params;
  return handle(request, domain, resolveCompaniesDeps());
}
