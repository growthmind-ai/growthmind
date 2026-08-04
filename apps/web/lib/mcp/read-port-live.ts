import {
  createFixesService,
  createGrowthContextService,
  createProjectsRepo,
  type ScopedDb,
} from "@growthmind/db";

import { toFindingRecord, toFixRecord, toGrowthContextRecord, toOpenFixRow } from "./dto";
import type {
  FindingRecord,
  FixRecord,
  GetFindingQuery,
  GetFixQuery,
  GetGrowthContextQuery,
  GrowthContextAnswer,
  ListOpenFixesQuery,
  McpReadPort,
  OpenFixPage,
} from "./read-port";

export function createLiveReadPort(db: ScopedDb): McpReadPort {
  return {
    async listOpenFixes(query: ListOpenFixesQuery): Promise<OpenFixPage> {
      const page = await createFixesService(db, query.principal).listOpen({
        projectId: query.projectId,
        limit: query.limit,
      });

      return { fixes: page.rows.map(toOpenFixRow), totalOpen: page.totalOpen };
    },

    async getFix(query: GetFixQuery): Promise<FixRecord | null> {
      const read = await createFixesService(db, query.principal).readFix(query.fixId);
      if (read === null) {
        return null;
      }

      return toFixRecord({
        fixId: read.fix.id,
        findingId: read.fix.findingId,
        status: read.fix.status,
        spec: read.spec,
        attempt: read.fix.attempt,
        alreadyLanded: read.fix.alreadyLanded,
        impact: read.impact,
        resultsBy: read.fix.resultsBy,
      });
    },

    // A finding with no derivable observation reads back as null here, so the answer is the
    // typed not-found rather than a schema throw the caller would see as a fault.
    async getFinding(query: GetFindingQuery): Promise<FindingRecord | null> {
      const read = await createFixesService(db, query.principal).readFinding(query.findingId);

      return read === null ? null : toFindingRecord(read);
    },

    async getGrowthContext(query: GetGrowthContextQuery): Promise<GrowthContextAnswer> {
      const projectId = await resolveProject(db, query);
      if (projectId.outcome !== "answered") {
        return projectId;
      }

      const read = await createGrowthContextService(db, query.principal).read({
        projectId: projectId.projectId,
        surface: query.surface,
      });

      return { outcome: "answered", record: toGrowthContextRecord(read) };
    },
  };
}

type ProjectResolution =
  | { readonly outcome: "answered"; readonly projectId: string }
  | { readonly outcome: "no_project" }
  | { readonly outcome: "ambiguous_project"; readonly projectIds: readonly string[] };

// An id the caller supplied is still read through the org-scoped repository, so another
// organization's project resolves to nothing rather than to an answer.
async function resolveProject(
  db: ScopedDb,
  query: GetGrowthContextQuery,
): Promise<ProjectResolution> {
  const projects = await createProjectsRepo(db, query.principal).list();

  if (query.projectId !== null) {
    const owned = projects.find((project) => project.id === query.projectId);
    return owned === undefined
      ? { outcome: "no_project" }
      : { outcome: "answered", projectId: owned.id };
  }

  const [only] = projects;
  if (only === undefined) {
    return { outcome: "no_project" };
  }

  return projects.length === 1
    ? { outcome: "answered", projectId: only.id }
    : { outcome: "ambiguous_project", projectIds: projects.map((project) => project.id) };
}
