import { asc, eq, inArray } from "drizzle-orm";

import type { ScopedDb } from "../repositories/types";
import { organization } from "../schema/auth";
import { projectConnections } from "../schema/project-connections";
import { projects } from "../schema/projects";

export interface AnalysableProject {
  readonly organizationId: string;

  readonly organizationName: string;
  readonly projectId: string;
}

export async function listAnalysableProjects(db: ScopedDb): Promise<AnalysableProject[]> {
  const rows = await db
    .selectDistinct({
      organizationId: projects.organizationId,
      projectId: projects.id,
    })
    .from(projects)
    .innerJoin(projectConnections, eq(projectConnections.projectId, projects.id))
    .where(eq(projectConnections.isActive, true))
    .orderBy(asc(projects.id));

  if (rows.length === 0) {
    return [];
  }

  const orgIds = [...new Set(rows.map((row) => row.organizationId))];
  const orgRows = await db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .where(inArray(organization.id, orgIds));
  const orgNames = new Map(orgRows.map((row) => [row.id, row.name]));

  return rows.map((row) => {
    const organizationName = orgNames.get(row.organizationId);
    if (organizationName === undefined) {
      throw new Error(`listAnalysableProjects: no organization row for project ${row.projectId}`);
    }

    return {
      organizationId: row.organizationId,
      organizationName,
      projectId: row.projectId,
    };
  });
}

export async function findAnalysableProject(
  db: ScopedDb,
  projectId: string,
): Promise<AnalysableProject | null> {
  const [row] = await db
    .select({
      organizationId: projects.organizationId,
      organizationName: organization.name,
      projectId: projects.id,
    })
    .from(projects)
    .innerJoin(organization, eq(organization.id, projects.organizationId))
    .where(eq(projects.id, projectId))
    .limit(1);

  return row ?? null;
}
